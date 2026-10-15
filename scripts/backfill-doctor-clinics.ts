// One-off backfill: gives every doctor record a `clinicIds` list, so the clinic
// switcher in the header has something to switch between.
//
//   bun scripts/backfill-doctor-clinics.ts --dry-run   # show what would change
//   bun scripts/backfill-doctor-clinics.ts             # make the changes
//   bun scripts/backfill-doctor-clinics.ts --assign-missing-to=1
//        # also give doctors who have NO clinic at all (nothing to derive one
//        # from) clinic number 1; without this they are only reported
//
// What it does, per document in `doctors`:
//   - has `clinicIds` already            -> left alone (safe to re-run)
//   - has only `clinicId`                -> clinicIds = [clinicId]
//   - has `clinicIds` but no `clinicId`  -> clinicId = clinicIds[0]
//   - has neither                        -> reported, not changed (unless
//                                           --assign-missing-to is given)
// It only ADDS fields; it never removes or rewrites one. The first entry of
// `clinicIds` is the doctor's home clinic and always mirrors `clinicId`, which
// older code (and "doctors where clinicId == N" queries) still reads.
//
// It acts as the project's service account, so it bypasses the security rules
// and needs no one to sign in. It reads FIREBASE_SERVICE_ACCOUNT from `.env`
// (bun loads `.env` from the folder you run it in) - the same secret the
// server uses for the SMS reminders - through the repo's own REST client in
// src/server/firestore-admin.ts. (The `firebase-admin` package isn't installed
// here: it can't run on Cloudflare Workers, which is why that client exists.)
import {
  firestoreAdminFromEnv,
  type FirestoreDoc,
} from "../src/server/firestore-admin";

export interface DoctorBackfillPlan {
  /** Documents to write, and the fields to set on each. */
  updates: { id: string; set: { clinicIds?: number[]; clinicId?: number } }[];
  /** Already fine. */
  untouched: string[];
  /** Needs a human: nothing to derive a clinic from, or the two fields disagree. */
  needsAttention: { id: string; why: string }[];
}

const asClinicNumber = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isInteger(v)) return v;
  if (typeof v === "string" && /^\d+$/.test(v.trim())) return Number(v.trim());
  return null;
};

/** What the backfill would do to these doctor documents. Pure; no database. */
export function planDoctorClinicBackfill(
  docs: Pick<FirestoreDoc, "id" | "data">[],
  options: { assignMissingTo?: number } = {},
): DoctorBackfillPlan {
  const plan: DoctorBackfillPlan = {
    updates: [],
    untouched: [],
    needsAttention: [],
  };
  for (const { id, data } of docs) {
    const list = Array.isArray(data.clinicIds)
      ? data.clinicIds.map(asClinicNumber)
      : null;
    const single = asClinicNumber(data.clinicId);

    if (list && list.length > 0 && list.every((n) => n !== null)) {
      const ids = list as number[];
      if (data.clinicId == null || data.clinicId === "") {
        plan.updates.push({ id, set: { clinicId: ids[0] } });
      } else if (single !== ids[0]) {
        plan.needsAttention.push({
          id,
          why: `clinicId (${String(data.clinicId)}) isn't the first of clinicIds (${ids.join(", ")})`,
        });
      } else {
        plan.untouched.push(id);
      }
      continue;
    }
    if (single !== null) {
      plan.updates.push({ id, set: { clinicIds: [single] } });
      continue;
    }
    const hasNothing = (!list || list.length === 0) && data.clinicId == null;
    if (hasNothing && options.assignMissingTo != null) {
      plan.updates.push({
        id,
        set: { clinicIds: [options.assignMissingTo] },
      });
      continue;
    }
    plan.needsAttention.push({
      id,
      why: list
        ? "clinicIds is empty or holds something that isn't a clinic number"
        : "no clinicId or clinicIds at all",
    });
  }
  return plan;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const flag = process.argv.find((a) => a.startsWith("--assign-missing-to="));
  const assignMissingTo = flag ? Number(flag.split("=")[1]) : undefined;
  if (flag && !Number.isInteger(assignMissingTo)) {
    console.error("--assign-missing-to needs a clinic number, e.g. --assign-missing-to=1");
    process.exit(1);
  }
  let fs;
  try {
    fs = firestoreAdminFromEnv(undefined);
  } catch (error) {
    console.error(
      `\nCan't connect: ${error instanceof Error ? error.message : error}\n` +
        "Set FIREBASE_SERVICE_ACCOUNT in .env (the service account JSON on one line),\n" +
        "and run this from the project folder so bun can find .env.\n",
    );
    process.exit(1);
  }

  console.log(`Project: ${fs.projectId}${dryRun ? "  (dry run - nothing will be written)" : ""}`);
  const docs = await fs.query("doctors", []);
  if (assignMissingTo != null) {
    const clinic = await fs.get("clinics", String(assignMissingTo));
    if (!clinic) {
      console.error(`Clinic ${assignMissingTo} doesn't exist; nothing was changed.`);
      process.exit(1);
    }
  }
  const plan = planDoctorClinicBackfill(docs, { assignMissingTo });
  console.log(`Doctors found: ${docs.length}`);

  let written = 0;
  let failed = 0;
  for (const u of plan.updates) {
    const what = Object.entries(u.set)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(", ");
    if (dryRun) {
      console.log(`  would update ${u.id}: ${what}`);
      continue;
    }
    try {
      await fs.write("doctors", u.id, u.set, {
        mask: Object.keys(u.set),
        precondition: { exists: true },
      });
      written++;
      console.log(`  updated ${u.id}: ${what}`);
    } catch (error) {
      failed++;
      console.error(
        `  FAILED ${u.id}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  console.log(
    `\n${dryRun ? "Would update" : "Updated"}: ${dryRun ? plan.updates.length : written}` +
      `   already fine: ${plan.untouched.length}` +
      `   needs a look: ${plan.needsAttention.length}` +
      (failed ? `   FAILED: ${failed}` : ""),
  );
  for (const n of plan.needsAttention) console.log(`  check ${n.id}: ${n.why}`);
  if (failed > 0) process.exit(1);
}

// Only when run directly, so the planning function can be imported by a test.
if (import.meta.main) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

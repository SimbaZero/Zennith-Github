// One-off backfill: gives every appointment that lacks a `clinicId` one, so it
// shows up in reception's appointment list (which queries `clinicId == N`).
//
//   bun scripts/backfill-appointment-clinics.ts --dry-run   # show what would change
//   bun scripts/backfill-appointment-clinics.ts             # make the changes
//
// Per appointment document:
//   - has `clinicId` already -> left alone (safe to re-run)
//   - the patient has one    -> the patient's clinicId (the clinic they attend)
//   - else the clinician has -> their home clinic (`clinicId`, or the first of
//                               `clinicIds`)
//   - neither                -> reported, not changed
// It only ADDS the field; it never removes or rewrites one.
//
// Acts as the project's service account (FIREBASE_SERVICE_ACCOUNT from `.env`),
// like backfill-doctor-clinics.ts, so it bypasses the security rules.
import {
  firestoreAdminFromEnv,
  type FirestoreDoc,
} from "../src/server/firestore-admin";

export interface AppointmentBackfillPlan {
  updates: { id: string; clinicId: number; from: "patient" | "clinician" }[];
  untouched: string[];
  needsAttention: { id: string; why: string }[];
}

const asClinicNumber = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isInteger(v)) return v;
  if (typeof v === "string" && /^\d+$/.test(v.trim())) return Number(v.trim());
  return null;
};

const homeClinic = (data: Record<string, unknown>): number | null =>
  asClinicNumber(data.clinicId) ??
  (Array.isArray(data.clinicIds) ? asClinicNumber(data.clinicIds[0]) : null);

/** What the backfill would do. Pure; no database. */
export function planAppointmentClinicBackfill(
  appointments: Pick<FirestoreDoc, "id" | "data">[],
  patientClinic: Map<string, number>,
  clinicianClinic: Map<string, number>,
): AppointmentBackfillPlan {
  const plan: AppointmentBackfillPlan = {
    updates: [],
    untouched: [],
    needsAttention: [],
  };
  for (const { id, data } of appointments) {
    if (asClinicNumber(data.clinicId) != null) {
      plan.untouched.push(id);
      continue;
    }
    const fromPatient = patientClinic.get(String(data.patientId ?? ""));
    if (fromPatient != null) {
      plan.updates.push({ id, clinicId: fromPatient, from: "patient" });
      continue;
    }
    const fromClinician = clinicianClinic.get(String(data.clinician ?? ""));
    if (fromClinician != null) {
      plan.updates.push({ id, clinicId: fromClinician, from: "clinician" });
      continue;
    }
    plan.needsAttention.push({
      id,
      why: `no clinic on patient ${data.patientId ?? "?"} or clinician ${data.clinician ?? "?"}`,
    });
  }
  return plan;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
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

  console.log(
    `Project: ${fs.projectId}${dryRun ? "  (dry run - nothing will be written)" : ""}`,
  );
  const appointments = await fs.query("appointments", []);
  const missing = appointments.filter(
    (a) => asClinicNumber(a.data.clinicId) == null,
  );
  console.log(
    `Appointments: ${appointments.length}, without a clinic: ${missing.length}`,
  );

  // Only the patients and clinicians the gaps actually mention are read.
  const patientIds = [
    ...new Set(
      missing.map((a) => String(a.data.patientId ?? "")).filter(Boolean),
    ),
  ];
  const patients = await fs.getMany("patients", patientIds);
  const patientClinic = new Map<string, number>();
  for (const [id, d] of patients) {
    const c = asClinicNumber(d.data.clinicId);
    if (c != null) patientClinic.set(id, c);
  }

  const clinicianClinic = new Map<string, number>();
  const clinicianIds = [
    ...new Set(
      missing.map((a) => String(a.data.clinician ?? "")).filter(Boolean),
    ),
  ];
  for (const [col, prefix] of [
    ["doctors", "Doc-"],
    ["nurses", "Nur-"],
  ] as const) {
    const ids = clinicianIds.filter((c) => c.startsWith(prefix));
    for (const [id, d] of await fs.getMany(col, ids)) {
      const c = homeClinic(d.data);
      if (c != null) clinicianClinic.set(id, c);
    }
  }

  const plan = planAppointmentClinicBackfill(
    appointments,
    patientClinic,
    clinicianClinic,
  );

  let written = 0;
  let failed = 0;
  for (const u of plan.updates) {
    const what = `clinicId=${u.clinicId} (from ${u.from})`;
    if (dryRun) {
      console.log(`  would update ${u.id}: ${what}`);
      continue;
    }
    try {
      await fs.write(
        "appointments",
        u.id,
        { clinicId: u.clinicId },
        { mask: ["clinicId"], precondition: { exists: true } },
      );
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

if (import.meta.main) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

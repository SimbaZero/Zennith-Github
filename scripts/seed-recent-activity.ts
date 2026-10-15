// Demo data: recent activity for a few clinics, so dashboards aren't empty.
//
//   bun scripts/seed-recent-activity.ts --dry-run   # print the plan, write nothing
//   bun scripts/seed-recent-activity.ts             # write it
//   bun scripts/seed-recent-activity.ts --purge     # delete everything this script added
//
// What it adds (Hillbrow 1, Berea 2, Tembisa 9):
//   - appointments: today + the next 4 days, 5 a day per clinic, booked with the
//     clinic's own doctor/nurses and its own existing patients
//   - acute-queue entries: 6 per clinic at different stages (3 waiting, 1 called,
//     1 in the room, 1 done) with mixed triage levels
//   - dispensing history: Tembisa only, today and the 3 days before, 6 rows a
//     day against its real stock. It does NOT change stock quantities.
//
// Every document carries `seeded: true` and `seedBatch`, so --purge removes
// exactly these and nothing else. It only ADDS documents (fixed ids for
// appointments and queue entries, so running it twice overwrites rather than
// duplicates; dispensing rows get generated ids, so purge before re-seeding).
//
// Acts as the project's service account (FIREBASE_SERVICE_ACCOUNT from `.env`).
import { firestoreAdminFromEnv, type FirestoreWrite } from "../src/server/firestore-admin";

export const SEED_BATCH = "demo-recent-2026-10-14";

interface ClinicPlan {
  clinicId: number;
  name: string;
  doctor?: string;
  nurses: string[];
  /** Pharmacy rows are written for this clinic only when set. */
  dispense?: boolean;
}

export const CLINICS: ClinicPlan[] = [
  { clinicId: 1, name: "Hillbrow CHC", doctor: "Doc-1", nurses: ["Nur-1"] },
  { clinicId: 2, name: "Berea CHC", doctor: "Doc-2", nurses: ["Nur-2"] },
  { clinicId: 9, name: "Tembisa Clinic", nurses: ["Nur-10", "Nur-609"], dispense: true },
];

const TYPES = [
  "Follow-up",
  "Consultation",
  "Chronic Care Follow-up",
  "Blood Pressure Check",
  "Diabetic Review",
  "Hypertension Review",
  "Medication Review",
];
const REASONS: [string, "red" | "orange" | "yellow" | "green"][] = [
  ["Chest pain", "red"],
  ["Fever, general malaise", "orange"],
  ["Wound dressing", "yellow"],
  ["Medication renewal", "green"],
  ["Skin rash", "green"],
  ["Diabetic review", "yellow"],
  ["Persistent cough", "yellow"],
  ["Follow-up review", "green"],
];

const pad = (n: number) => String(n).padStart(2, "0");
/** South Africa is UTC+2 all year. Stored appointment times are clinic wall-clock labelled Z. */
const SAST_MS = 2 * 3600_000;
function sastNow(now: Date) {
  return new Date(now.getTime() + SAST_MS);
}
function ymd(d: Date) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export interface SeedPlan {
  writes: FirestoreWrite[];
  counts: { appointments: number; queue: number; dispensing: number };
}

/** Pure: builds every document. `patients` are existing patient ids per clinic. */
export function buildPlan(input: {
  now: Date;
  patients: Record<number, string[]>;
  names: Record<string, string>;
  /** Existing "clinician|ISO" slots, so a new appointment never double-books. */
  taken: Set<string>;
  stock: Record<number, { inventId: number; medName: string }[]>;
}): SeedPlan {
  const { now, patients, names, taken, stock } = input;
  const writes: FirestoreWrite[] = [];
  const counts = { appointments: 0, queue: 0, dispensing: 0 };
  const wall = sastNow(now);
  const minsAgo = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();

  for (const c of CLINICS) {
    const pool = patients[c.clinicId] ?? [];
    if (pool.length < 12) throw new Error(`Clinic ${c.clinicId}: only ${pool.length} patients to draw on`);
    const clinicians = [...(c.doctor ? [c.doctor] : []), ...c.nurses];

    // ---- appointments: today + 4 days, 5 per day ----
    const slots = ["08:30", "09:30", "10:30", "11:30", "13:00", "14:00", "15:00", "16:00"];
    let seq = 0;
    for (let day = 0; day < 5; day++) {
      const date = new Date(Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate() + day));
      for (let i = 0; i < 5; i++) {
        const clinician = clinicians[(seq + day) % clinicians.length];
        const time = slots[(i + day) % slots.length];
        const iso = `${ymd(date)}T${time}:00.000Z`;
        const key = `${clinician}|${iso}`;
        if (taken.has(key)) continue;
        taken.add(key);
        const hh = Number(time.slice(0, 2));
        const earlierToday = day === 0 && hh * 60 + Number(time.slice(3)) < wall.getUTCHours() * 60 + wall.getUTCMinutes();
        const id = String(9_100_000 + c.clinicId * 1000 + seq);
        writes.push({
          set: ["appointments", id],
          data: {
            appointmentId: Number(id),
            appointDateTime: iso,
            appointType: TYPES[(seq + c.clinicId) % TYPES.length],
            clinician,
            clinicId: c.clinicId,
            patientId: pool[seq % pool.length],
            status: earlierToday ? "Completed" : (seq % 3 === 0 ? "Confirmed" : "Scheduled"),
            seeded: true,
            seedBatch: SEED_BATCH,
          },
        });
        counts.appointments++;
        seq++;
      }
    }

    // ---- acute queue: six entries at different stages ----
    const stages: { status: string; joined: number; called?: number; inRoom?: number; done?: number }[] = [
      { status: "waiting", joined: 4 },
      { status: "waiting", joined: 12 },
      { status: "waiting", joined: 21 },
      { status: "called", joined: 26, called: 3 },
      { status: "in-room", joined: 41, called: 22, inRoom: 15 },
      { status: "done", joined: 95, called: 85, inRoom: 78, done: 55 },
    ];
    stages.forEach((s, i) => {
      const patientId = pool[(10 + i) % pool.length];
      const [reason, triage] = REASONS[(i + c.clinicId) % REASONS.length];
      writes.push({
        set: ["queue", `Q-seed-${c.clinicId}-${i + 1}`],
        data: {
          patientId,
          patientName: names[patientId] ?? null,
          reason,
          clinician: s.status === "waiting" ? null : c.nurses[i % c.nurses.length],
          triage,
          priority: triage === "red" || triage === "orange" ? "urgent" : "normal",
          status: s.status,
          joinedAt: minsAgo(s.joined),
          calledAt: s.called != null ? minsAgo(s.called) : null,
          inRoomAt: s.inRoom != null ? minsAgo(s.inRoom) : null,
          doneAt: s.done != null ? minsAgo(s.done) : null,
          facilityId: String(c.clinicId),
          handedOffTo: null,
          handedOffAt: null,
          handedOffBy: null,
          seeded: true,
          seedBatch: SEED_BATCH,
        },
      });
      counts.queue++;
    });

    // ---- dispensing history (Tembisa only): today and the 3 days before ----
    if (c.dispense) {
      const meds = stock[c.clinicId] ?? [];
      if (meds.length === 0) throw new Error(`Clinic ${c.clinicId}: no stock to dispense from`);
      const unitsFor = (i: number) => [5, 10, 15, 20, 10, 5][i % 6];
      let n = 0;
      for (let back = 0; back < 4; back++) {
        for (let row = 0; row < 6; row++) {
          const med = meds[row % meds.length];
          // 08:20 + 70 minutes a row, SAST, expressed as the real instant (UTC).
          const local = new Date(Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate() - back, 8, 20 + row * 70));
          const at = new Date(local.getTime() - SAST_MS);
          if (at.getTime() > now.getTime()) continue; // nothing in the future today
          writes.push({
            create: "patientDispensing",
            data: {
              dispenseId: at.getTime() + n,
              patientId: pool[(n * 3 + 5) % pool.length],
              clinicId: c.clinicId,
              medName: med.medName,
              inventId: med.inventId,
              unitsGiven: unitsFor(n),
              nurseId: c.nurses[n % c.nurses.length],
              note: null,
              createdAt: at,
              seeded: true,
              seedBatch: SEED_BATCH,
            },
          });
          counts.dispensing++;
          n++;
        }
      }
    }
  }
  return { writes, counts };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const purge = process.argv.includes("--purge");
  const fs: any = firestoreAdminFromEnv(undefined);
  const token: string = await fs.accessToken();
  let reads = 0;

  const run = async (structuredQuery: Record<string, unknown>) => {
    const r = await fetch(`${fs.documentsUrl}:runQuery`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ structuredQuery }),
    });
    if (!r.ok) throw new Error(`query failed ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const rows = (await r.json()) as { document?: { name: string; fields?: Record<string, any> } }[];
    const docs = rows.filter((x) => x.document).map((x) => x.document!);
    reads += docs.length;
    return docs;
  };
  const eqIn = (field: string, values: (string | number)[]) => ({
    fieldFilter: {
      field: { fieldPath: field },
      op: "IN",
      value: { arrayValue: { values: values.map((v) => (typeof v === "number" ? { integerValue: String(v) } : { stringValue: v })) } },
    },
  });
  const str = (f: any) => f?.stringValue as string | undefined;
  const idOf = (d: { name: string }) => d.name.split("/").pop()!;

  console.log(`Project: ${fs.projectId}${dryRun ? "  (dry run - nothing will be written)" : ""}`);

  if (purge) {
    let deleted = 0;
    for (const col of ["appointments", "queue", "patientDispensing"]) {
      const docs = await run({
        from: [{ collectionId: col }],
        where: { fieldFilter: { field: { fieldPath: "seedBatch" }, op: "EQUAL", value: { stringValue: SEED_BATCH } } },
      });
      console.log(`${col}: ${docs.length} seeded documents`);
      if (dryRun) continue;
      for (const d of docs) {
        const r = await fetch(`https://firestore.googleapis.com/v1/${d.name}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
        if (r.ok) deleted++;
      }
    }
    console.log(dryRun ? "(dry run)" : `Deleted ${deleted}.  reads: ${reads}  deletes: ${deleted}`);
    return;
  }

  const now = new Date();
  const patients: Record<number, string[]> = {};
  const userIds: Record<string, string> = {};
  for (const c of CLINICS) {
    const docs = await run({ from: [{ collectionId: "patients" }], where: eqIn("clinicId", [c.clinicId]), limit: 40 });
    patients[c.clinicId] = docs.map(idOf);
    for (const d of docs) {
      const uid = d.fields?.userId?.integerValue ?? d.fields?.userId?.stringValue;
      if (uid != null) userIds[idOf(d)] = String(uid);
    }
  }
  // Names for the queue entries (the six per clinic that will be shown).
  const names: Record<string, string> = {};
  const wanted = CLINICS.flatMap((c) => [0, 1, 2, 3, 4, 5].map((i) => patients[c.clinicId][(10 + i) % patients[c.clinicId].length]));
  const got = await fs.getMany("users", [...new Set(wanted.map((p) => userIds[p]).filter(Boolean))]);
  reads += got.size;
  for (const p of wanted) {
    const u = got.get(userIds[p]);
    if (u) names[p] = [u.data.names, u.data.surname].filter(Boolean).join(" ");
  }

  // Existing future appointments, so nothing is double-booked.
  const today = ymd(sastNow(now));
  const future = await run({
    from: [{ collectionId: "appointments" }],
    where: { fieldFilter: { field: { fieldPath: "appointDateTime" }, op: "GREATER_THAN_OR_EQUAL", value: { stringValue: today } } },
  });
  const taken = new Set(future.map((d) => `${str(d.fields?.clinician)}|${str(d.fields?.appointDateTime)}`));

  // Tembisa's real stock, for dispensing rows.
  const stock: Record<number, { inventId: number; medName: string }[]> = {};
  for (const c of CLINICS.filter((x) => x.dispense)) {
    const inv = await run({ from: [{ collectionId: "inventory" }], where: eqIn("clinicId", [c.clinicId, String(c.clinicId)]) });
    stock[c.clinicId] = inv.map((d) => ({
      inventId: Number(d.fields?.inventId?.stringValue ?? d.fields?.inventId?.integerValue ?? idOf(d)),
      medName: str(d.fields?.medName) ?? "Unknown",
    }));
  }

  const plan = buildPlan({ now, patients, names, taken, stock });
  console.log(`Plan: ${plan.counts.appointments} appointments, ${plan.counts.queue} queue entries, ${plan.counts.dispensing} dispensing rows = ${plan.writes.length} writes`);
  console.log(`Reads so far: ${reads}`);
  if (dryRun) {
    for (const w of plan.writes.slice(0, 6)) console.log(" ", JSON.stringify(w).slice(0, 200));
    return;
  }

  let written = 0;
  for (let i = 0; i < plan.writes.length; i += 100) {
    const chunk = plan.writes.slice(i, i + 100);
    await fs.commit(chunk);
    written += chunk.length;
  }
  console.log(`Wrote ${written} documents.  reads: ${reads}  writes: ${written}`);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

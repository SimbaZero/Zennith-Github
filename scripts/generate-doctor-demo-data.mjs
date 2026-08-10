// Adds a fuller week (and a bit of the following week) of real appointments
// for both doctors, plus pins their clinicId deterministically (Doc-1 ->
// Hillbrow, Doc-2 -> Berea) so their dashboards/appointments pages have
// enough real data to actually demo, not just 1-2 scattered entries.
// Additive, safe to re-run — fixed IDs.
//
//   node scripts/generate-doctor-demo-data.mjs
//
import { readFileSync } from "node:fs";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { collection, doc, getFirestore, writeBatch } from "firebase/firestore";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => [
      l.slice(0, l.indexOf("=")).trim(),
      l.slice(l.indexOf("=") + 1).trim(),
    ]),
);
const app = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  appId: env.VITE_FIREBASE_APP_ID,
});
const auth = getAuth(app);
const db = getFirestore(app);
const retry = async (fn, n = 4) => {
  for (let i = 0; i < n; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i === n - 1) throw e;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
};
await retry(() =>
  signInWithEmailAndPassword(auth, "admin@zennith.test", "password"),
);

let seed = 20260811;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0xffffffff;
};
const pick = (a) => a[Math.floor(rnd() * a.length)];
const dt = (offsetDays, hhmm) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.toISOString().slice(0, 10)}T${hhmm}:00.000Z`;
};
const hhmm = () =>
  `${String(8 + Math.floor(rnd() * 8)).padStart(2, "0")}:${pick(["00", "15", "30", "45"])}`;

const TYPES = [
  "Consultation",
  "Follow-up",
  "Hypertension Review",
  "Diabetic Review",
  "Chronic Care Review",
  "Medication Renewal",
];

const batch = writeBatch(db);
batch.set(
  doc(db, "doctors", "Doc-1"),
  {
    doctorId: "Doc-1",
    clinicId: 1,
    specialisation: "General Practice",
    licenseNo: "MP100001",
    userId: 1,
  },
  { merge: true },
);
batch.set(
  doc(db, "doctors", "Doc-2"),
  {
    doctorId: "Doc-2",
    clinicId: 2,
    specialisation: "Paediatrics",
    licenseNo: "MP100002",
    userId: 2,
  },
  { merge: true },
);

let apptId = 13000;
// Spread across last week -> next week (-7 to +7 days), skipping weekends occasionally for realism.
for (let offset = -7; offset <= 7; offset++) {
  const dow = new Date(Date.now() + offset * 86400000).getDay();
  if ((dow === 0 || dow === 6) && rnd() < 0.6) continue; // mostly skip weekends
  const perDay = 2 + Math.floor(rnd() * 4);
  for (let i = 0; i < perDay; i++) {
    const clinicId = rnd() < 0.5 ? 1 : 2;
    const patBase = clinicId === 1 ? 2000 : 2100;
    const patId = `Pat-${patBase + 1 + Math.floor(rnd() * 30)}`;
    batch.set(doc(db, "appointments", String(apptId)), {
      appointmentId: apptId,
      appointDateTime: dt(offset, hhmm()),
      appointType: pick(TYPES),
      clinician: clinicId === 1 ? "Doc-1" : "Doc-2",
      clinicId,
      patientId: patId,
      status:
        offset < 0 ? pick(["Complete", "Incomplete", "No-show"]) : "Scheduled",
    });
    apptId++;
  }
}

await retry(() => batch.commit());
console.log(
  `Done. Doc-1 -> Hillbrow, Doc-2 -> Berea, real appointments seeded -7 to +7 days.`,
);
process.exit();

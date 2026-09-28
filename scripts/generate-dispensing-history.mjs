// Seeds 30 days of realistic dispensing history so the pharmacy forecasting
// has something to work from.
//
// Writes to `patientDispensing` — what nurses actually hand to patients, and
// what useMedicationUsage reads. Deliberately does NOT decrease inventory:
// the stock on hand is the current real figure, and the point here is to give
// the forecast a usage rate, not to rewrite stock history.
//
// Chronic medication moves steadily every weekday; acute medication is
// bursty. Weekends are quiet. That shape is what makes a forecast look like a
// clinic rather than a random number generator.
//
//   node scripts/generate-dispensing-history.mjs
//
import { readFileSync } from "node:fs";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import {
  collection,
  getDocs,
  getFirestore,
  query,
  where,
  writeBatch,
  doc,
  Timestamp,
} from "firebase/firestore";

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
await signInWithEmailAndPassword(
  getAuth(app),
  "admin@zennith.test",
  "password",
);
const db = getFirestore(app);

const DAYS = 30;
const CLINICS = [1, 2];

// Rough daily demand per medication. Chronic conditions are dispensed in a
// steady stream; painkillers and antihistamines come in bursts.
function profileFor(name) {
  const n = name.toLowerCase();
  if (/lamivudine|tdf|dtg|tld|arv/.test(n))
    return { base: 14, spread: 5, chronic: true };
  if (/metformin|insulin|glic|diabet/.test(n))
    return { base: 10, spread: 4, chronic: true };
  if (/amlodipine|hydrochloro|blood pressure/.test(n))
    return { base: 8, spread: 3, chronic: true };
  if (/valproate|epilep|phenytoin/.test(n))
    return { base: 4, spread: 2, chronic: true };
  if (/paracetamol|ibuprofen|analges/.test(n))
    return { base: 6, spread: 6, chronic: false };
  if (/antihistamine|allerg/.test(n))
    return { base: 3, spread: 4, chronic: false };
  return { base: 3, spread: 3, chronic: false };
}

// Deterministic pseudo-random, so re-running gives the same history rather
// than a different clinic every time.
let seed = 20260927;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};

let written = 0;

for (const clinicId of CLINICS) {
  const [invSnap, patSnap, nurseSnap] = await Promise.all([
    getDocs(
      query(collection(db, "inventory"), where("clinicId", "==", clinicId)),
    ),
    getDocs(
      query(collection(db, "patients"), where("clinicId", "==", clinicId)),
    ),
    getDocs(query(collection(db, "nurses"), where("clinicId", "==", clinicId))),
  ]);

  const meds = invSnap.docs
    .map((d) => ({
      name: d.data().medName,
      inventId: Number(d.data().inventId),
    }))
    .filter((m) => m.name);
  const patients = patSnap.docs.map((d) => d.id);
  const nurses = nurseSnap.docs.map((d) => d.id);

  if (meds.length === 0 || patients.length === 0) {
    console.log(`Clinic ${clinicId}: no inventory or patients — skipped.`);
    continue;
  }

  let batch = writeBatch(db);
  let inBatch = 0;

  for (let dayBack = DAYS - 1; dayBack >= 0; dayBack--) {
    const day = new Date();
    day.setDate(day.getDate() - dayBack);
    const weekday = day.getDay();
    const quiet = weekday === 0 || weekday === 6; // Sunday / Saturday

    for (const med of meds) {
      const p = profileFor(med.name);
      // Acute medication doesn't move every day.
      if (!p.chronic && rnd() < 0.45) continue;
      if (quiet && rnd() < 0.7) continue;

      const events = Math.max(
        0,
        Math.round(p.base / 4 + (rnd() - 0.5) * p.spread),
      );
      for (let e = 0; e < events; e++) {
        const when = new Date(day);
        // Clinic hours, roughly 8am to 4pm.
        when.setHours(8 + Math.floor(rnd() * 8), Math.floor(rnd() * 60), 0, 0);

        batch.set(doc(collection(db, "patientDispensing")), {
          dispenseId: Date.now() + written,
          patientId: patients[Math.floor(rnd() * patients.length)],
          clinicId,
          medName: med.name,
          inventId: med.inventId,
          unitsGiven: p.chronic ? 30 : 1 + Math.floor(rnd() * 3),
          nurseId: nurses[Math.floor(rnd() * nurses.length)] ?? "Nur-1",
          note: null,
          createdAt: Timestamp.fromDate(when),
        });

        written++;
        inBatch++;
        if (inBatch >= 400) {
          await batch.commit();
          batch = writeBatch(db);
          inBatch = 0;
        }
      }
    }
  }

  if (inBatch > 0) await batch.commit();
  console.log(`Clinic ${clinicId}: seeded from ${meds.length} medications.`);
}

console.log(`\n${written} dispensing events written across ${DAYS} days.`);
console.log("Reload the pharmacist Medication Overview to see the forecasts.");
process.exit();

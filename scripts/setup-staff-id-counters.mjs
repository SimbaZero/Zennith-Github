// One-time (safe to re-run) setup: adds a numeric ID counter for each
// staff role — doctorNo, nurseNo, pharmacistNo, receptionistNo — to the
// existing counters/registration doc, alongside the patientNo/userNo/
// recordNo/distributionNo counters already there.
//
// Doesn't guess a starting number — scans each real collection, finds the
// highest number actually in use (e.g. Doc-105 -> 105), and sets the
// counter to that. Safe to re-run: only ever raises a counter, never
// lowers one, so running it twice changes nothing the second time.
//
//   node scripts/setup-staff-id-counters.mjs
//
import { readFileSync } from "node:fs";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  setDoc,
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
const auth = getAuth(app);
const db = getFirestore(app);
await signInWithEmailAndPassword(auth, "admin@zennith.test", "password");

const ROLE_COLLECTIONS = {
  doctorNo: "doctors",
  nurseNo: "nurses",
  pharmacistNo: "pharmacists",
  receptionistNo: "receptionists",
};

console.log("=== Finding the highest real ID in each staff collection ===\n");

const maxByField = {};
for (const [counterField, collectionName] of Object.entries(ROLE_COLLECTIONS)) {
  const snap = await getDocs(collection(db, collectionName));
  let max = 0;
  for (const d of snap.docs) {
    const match = d.id.match(/-(\d+)$/);
    if (match) max = Math.max(max, Number(match[1]));
  }
  maxByField[counterField] = max;
  console.log(
    `${collectionName}: highest ID number found is ${max} (${snap.size} records)`,
  );
}

console.log("\n=== Updating counters/registration ===\n");
const ref = doc(db, "counters", "registration");
const snap = await getDoc(ref);
const current = snap.exists() ? snap.data() : {};

const updates = {};
for (const [field, max] of Object.entries(maxByField)) {
  const existing = current[field] ?? 0;
  updates[field] = Math.max(existing, max);
  console.log(`${field}: ${existing} -> ${updates[field]}`);
}

await setDoc(ref, { ...current, ...updates }, { merge: true });
console.log(
  "\nDone. Next staff account created of each type will start one above these numbers.",
);
process.exit();

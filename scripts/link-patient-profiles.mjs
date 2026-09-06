// Adds patientId to every patient login profile.
//
// Needed before security rules can work. To enforce "a patient can only read
// their own medical record", a Firestore rule has to know which patient the
// signed-in user IS. Profiles currently store legacyUserId (the numeric
// users.userId) but not the patientId ("Pat-123") that medical records,
// appointments and queue entries are keyed on — and a rule can't follow that
// chain of lookups. Storing it directly on the profile makes the rules exact
// and cheap.
//
// Safe to re-run: skips profiles that already have it.
//
//   node scripts/link-patient-profiles.mjs
//
import { readFileSync } from "node:fs";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import {
  collection,
  getDocs,
  getFirestore,
  updateDoc,
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

const [profileDocs, patientDocs] = await Promise.all([
  getDocs(collection(db, "profiles")),
  getDocs(collection(db, "patients")),
]);

// userId -> patientId
const patientByUserId = new Map();
for (const d of patientDocs.docs) {
  const uid = Number(d.data().userId);
  if (Number.isFinite(uid)) patientByUserId.set(uid, d.id);
}

let updated = 0;
let already = 0;
const unmatched = [];

for (const p of profileDocs.docs) {
  const data = p.data();
  if (data.role !== "patient") continue;

  if (data.patientId) {
    already++;
    continue;
  }
  if (data.legacyUserId == null) {
    unmatched.push(`${data.username ?? p.id}: no legacyUserId`);
    continue;
  }

  const patientId = patientByUserId.get(Number(data.legacyUserId));
  if (!patientId) {
    unmatched.push(
      `${data.username ?? p.id}: legacyUserId ${data.legacyUserId} matches no patient record`,
    );
    continue;
  }

  await updateDoc(p.ref, { patientId });
  console.log(`${data.username ?? p.id} -> ${patientId}`);
  updated++;
}

console.log(`\n${updated} linked, ${already} already had one.`);
if (unmatched.length) {
  console.log(`\n${unmatched.length} could not be linked:`);
  unmatched.forEach((u) => console.log("  • " + u));
  console.log(
    "\nThese patients won't be able to read their own records once rules\n" +
      "are tightened. Worth checking whether they're real or leftover tests.",
  );
}

process.exit();

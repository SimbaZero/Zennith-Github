// One-time (safe to re-run) setup: adds a clinicNo counter to
// counters/registration, so new real clinics get a real, non-colliding
// numeric ID. Scans the real clinics collection for the highest ID
// actually in use — doesn't guess a starting number.
//
//   node scripts/setup-clinic-id-counter.mjs
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

const snap = await getDocs(collection(db, "clinics"));
let max = 0;
for (const d of snap.docs) {
  const n = Number(d.data().clinicId);
  if (Number.isFinite(n)) max = Math.max(max, n);
}
console.log(`Real clinics: ${snap.size} found, highest clinicId is ${max}`);

const ref = doc(db, "counters", "registration");
const current = (await getDoc(ref)).exists() ? (await getDoc(ref)).data() : {};
const existing = current.clinicNo ?? 0;
const next = Math.max(existing, max);
await setDoc(ref, { ...current, clinicNo: next }, { merge: true });
console.log(`clinicNo: ${existing} -> ${next}`);
console.log("Done.");
process.exit();

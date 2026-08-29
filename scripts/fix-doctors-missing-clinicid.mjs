// Fixes doctors with no clinicId at all (found by migrate-staff-clinicids.mjs —
// these are unattributed bulk demo doctors, not named test-login accounts).
// Sets BOTH clinicId and clinicIds so they're consistent immediately, not
// half-migrated. Safe to re-run — only touches docs still missing clinicId.
//
//   node scripts/fix-doctors-missing-clinicid.mjs
//
import { readFileSync } from "node:fs";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import {
  collection,
  getDocs,
  getFirestore,
  doc,
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

const DEFAULT_CLINIC_ID = 1; // Hillbrow CHC

const snap = await getDocs(collection(db, "doctors"));
let fixed = 0;
const touched = [];

for (const d of snap.docs) {
  const data = d.data();
  if (typeof data.clinicId === "number") continue; // already fine, leave alone
  await updateDoc(doc(db, "doctors", d.id), {
    clinicId: DEFAULT_CLINIC_ID,
    clinicIds: [DEFAULT_CLINIC_ID],
  });
  touched.push(d.id);
  fixed++;
}

console.log(`Fixed ${fixed} doctor(s): ${touched.join(", ") || "none"}`);
console.log("Done.");
process.exit();

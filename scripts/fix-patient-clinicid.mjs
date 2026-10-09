// Finds and fixes patient rows where clinicId was stored as text instead of
// a number (e.g. hand-edited in the Firebase console, which defaults new
// fields to string type unless you pick "number" from the dropdown).
//
// Why it matters: Firestore keeps the type you give it. A document holding
// clinicId: "1" (string) never matches a query asking for clinicId == 1
// (number), so that patient silently disappears from any list built with a
// plain equality query. The app's newer queries tolerate both types
// (src/lib/clinic-id.ts), but older ones don't, and the underlying bad data
// stays a trap for every future query that isn't specifically patched for it.
//
// Shows what it will change and asks before writing anything.
//
//   node scripts/fix-patient-clinicid.mjs
//
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
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

const snap = await getDocs(collection(db, "patients"));
const fixes = [];

for (const d of snap.docs) {
  const data = d.data();
  const v = data.clinicId;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) {
      fixes.push({ ref: d.ref, id: d.id, name: data.name, from: v, to: n });
    }
  }
}

console.log(`\nScanned ${snap.size} patient rows.\n`);

if (fixes.length === 0) {
  console.log("All clinicId fields are already stored as numbers. Nothing to do.");
  process.exit();
}

console.log(`${fixes.length} patient(s) have clinicId stored as text:\n`);
for (const f of fixes) {
  console.log(`  ${f.name ?? "(unnamed)"} [${f.id}]  clinicId: "${f.from}" -> ${f.to}`);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = await rl.question("\nType YES to fix these: ");
rl.close();
if (answer.trim() !== "YES") {
  console.log("Cancelled. Nothing changed.");
  process.exit();
}

for (const f of fixes) {
  await updateDoc(f.ref, { clinicId: f.to });
  console.log(`Fixed ${f.name ?? f.id}`);
}

console.log(`\n${fixes.length} patient(s) fixed.`);
process.exit();

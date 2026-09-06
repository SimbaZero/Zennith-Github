// Finds and fixes inventory rows where quantity or threshold was stored as
// text instead of a number.
//
// Why it matters: Firestore keeps the type you give it. "170" is a string,
// and string arithmetic silently produces nonsense — "170" + 50 becomes
// "17050", and comparisons like quantity < threshold compare alphabetically
// rather than numerically. The app already works around this with a
// toNumber() helper on reads, but the underlying data stays wrong, which
// makes any query or aggregation done outside that helper unreliable.
//
// Shows what it will change and asks before writing.
//
//   node scripts/fix-inventory-number-types.mjs
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

const NUMERIC_FIELDS = ["quantity", "threshold", "inventId", "clinicId"];

const snap = await getDocs(collection(db, "inventory"));
const fixes = [];

for (const d of snap.docs) {
  const data = d.data();
  const changes = {};
  for (const field of NUMERIC_FIELDS) {
    const v = data[field];
    if (typeof v === "string" && v.trim() !== "") {
      const n = Number(v);
      if (Number.isFinite(n)) changes[field] = n;
    }
  }
  if (Object.keys(changes).length > 0) {
    fixes.push({ ref: d.ref, id: d.id, name: data.medName, changes });
  }
}

console.log(`\nScanned ${snap.size} inventory rows.\n`);

if (fixes.length === 0) {
  console.log(
    "All numeric fields are already stored as numbers. Nothing to do.",
  );
  process.exit();
}

console.log(`${fixes.length} row(s) have text where a number belongs:\n`);
for (const f of fixes) {
  const desc = Object.entries(f.changes)
    .map(([k, v]) => `${k}: "${v}" -> ${v}`)
    .join(", ");
  console.log(`  ${f.name ?? "(unnamed)"} [doc ${f.id}]  ${desc}`);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = await rl.question("\nType YES to fix these: ");
rl.close();
if (answer.trim() !== "YES") {
  console.log("Cancelled. Nothing changed.");
  process.exit();
}

for (const f of fixes) {
  await updateDoc(f.ref, f.changes);
  console.log(`Fixed ${f.name ?? f.id}`);
}

console.log(`\n${fixes.length} row(s) fixed.`);
process.exit();

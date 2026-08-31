// Merges the two confirmed duplicate inventory groups at Hillbrow CHC.
//
// Deliberately NOT automatic — the groups are listed explicitly below,
// because a name-similarity matcher would also flag "Metformin 500mg" and
// "Metformin 850mg", which are genuinely different medications.
//
// Keeps the row with the numeric document id (referenced by demo scripts
// and other collections), adds the other's quantity to it, deletes the
// duplicate.
//
//   node scripts/merge-duplicate-inventory.mjs
//
import { readFileSync } from "node:fs";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import {
  doc,
  getDoc,
  getFirestore,
  updateDoc,
  deleteDoc,
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

// keep = the doc that survives, absorb = the doc that gets merged in and removed.
// correctName / correctCategory fix the bad data while we're here.
const MERGES = [
  {
    keep: "21",
    absorb: "23",
    correctName: "Lamivudine/TDF/DTG",
    correctCategory: "Antiretroviral", // both rows had wrong categories
  },
  {
    keep: "5100",
    absorb: "HS70bm9EBqaLE0zjS4tc",
    correctName: "Metformin 850mg",
    correctCategory: "Antidiabetic",
  },
];

for (const m of MERGES) {
  const keepRef = doc(db, "inventory", m.keep);
  const absorbRef = doc(db, "inventory", m.absorb);

  const [keepSnap, absorbSnap] = await Promise.all([
    getDoc(keepRef),
    getDoc(absorbRef),
  ]);

  if (!keepSnap.exists()) {
    console.log(`Skipping — keep doc ${m.keep} no longer exists.`);
    continue;
  }
  if (!absorbSnap.exists()) {
    console.log(`Skipping — duplicate ${m.absorb} already gone.`);
    continue;
  }

  const keepQty = Number(keepSnap.data().quantity) || 0;
  const absorbQty = Number(absorbSnap.data().quantity) || 0;
  const total = keepQty + absorbQty;

  await updateDoc(keepRef, {
    medName: m.correctName,
    category: m.correctCategory,
    quantity: total, // written as a real number, fixing any string values
    lastUpdated: new Date().toISOString(),
  });
  await deleteDoc(absorbRef);

  console.log(
    `${m.correctName}: ${keepQty} + ${absorbQty} = ${total} (kept doc ${m.keep}, removed ${m.absorb})`,
  );
}

console.log("\nDone.");
process.exit();

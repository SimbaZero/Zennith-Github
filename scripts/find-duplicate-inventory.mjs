// Read-only. Finds inventory rows that are probably the same medication
// recorded twice at the same clinic — e.g. "Metformin" and "Metformin 850mg",
// or the same name entered twice. Changes nothing; just reports.
//
//   node scripts/find-duplicate-inventory.mjs
//
import { readFileSync } from "node:fs";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { collection, getDocs, getFirestore } from "firebase/firestore";

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

const clinicNames = new Map();
for (const d of (await getDocs(collection(db, "clinics"))).docs) {
  clinicNames.set(Number(d.data().clinicId), d.data().clinicName);
}

const snap = await getDocs(collection(db, "inventory"));
const rows = snap.docs.map((d) => ({
  docId: d.id,
  name: String(d.data().medName ?? "").trim(),
  qty: Number(d.data().quantity) || 0,
  clinicId: Number(d.data().clinicId),
  category: d.data().category ?? "",
}));

// Group by clinic, then by a loosened form of the name: lowercased, with
// dosage/strength stripped. That's what makes "Metformin" and
// "Metformin 850mg" collide, which is the case we actually care about.
const loosen = (n) =>
  n
    .toLowerCase()
    .replace(/\d+\s*(mg|ml|g|mcg|iu)\b/g, "")
    .replace(/[^a-z/]/g, "")
    .trim();

const groups = new Map();
for (const r of rows) {
  if (!r.name) continue;
  const key = `${r.clinicId}::${loosen(r.name)}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(r);
}

const dupes = [...groups.entries()].filter(([, v]) => v.length > 1);

console.log(`\nScanned ${rows.length} inventory rows.\n`);

if (dupes.length === 0) {
  console.log("No duplicates found.");
} else {
  console.log(`Found ${dupes.length} possible duplicate group(s):\n`);
  for (const [key, items] of dupes) {
    const clinicId = Number(key.split("::")[0]);
    console.log(
      `  ${clinicNames.get(clinicId) ?? `Clinic ${clinicId}`} (clinicId ${clinicId}):`,
    );
    for (const i of items) {
      console.log(
        `     "${i.name}"  qty ${i.qty}  [${i.category}]  doc ${i.docId}`,
      );
    }
    const total = items.reduce((s, i) => s + i.qty, 0);
    console.log(`     -> combined would be ${total}\n`);
  }
  console.log(
    "Nothing has been changed. Check these are genuinely the same medication\n" +
      "before merging — different strengths of the same drug are NOT duplicates.",
  );
}

process.exit();

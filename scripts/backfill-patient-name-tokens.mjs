// Gives every existing patient the searchable name that reception's Patient
// Profiles search needs: `nameTokensLower`, the lowercase words of the name,
// e.g. "Lerato Molefe" -> ["lerato", "molefe"].
//
// Why it's needed: a patient's name isn't stored on their own `patients`
// document — it lives on the linked `users` document — so a database query had
// nothing to match a name against, and only patients already in the loaded page
// could be found by name. New registrations and self-signups, and any name edit
// made on reception's profile page, write the field themselves. Patients who
// existed before that — and anyone created by a seeding script, none of which
// write it — don't have it, so name search can't find them until this runs.
//
// For every patient it looks up the linked users document, works out the words
// from names + surname, and compares them with what's stored. It lists, before
// changing anything:
//   - who it WILL update (field missing, or no longer matching their name);
//   - who it will SKIP, and why (no userId, linked user document missing, linked
//     user has no name) — those need a person to look at them, not a guess;
//   - how many are already correct.
// Then it asks before writing. It writes `nameTokensLower` and nothing else.
//
// Safe to re-run: patients already correct are left alone.
//
//   node scripts/backfill-patient-name-tokens.mjs
//
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import {
  collection,
  getDocs,
  getFirestore,
  writeBatch,
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

// A copy of nameTokens() in src/lib/clinic-data.ts (a script can't import the
// TypeScript). Keep the two in step: if the rule changes there, change it here
// and re-run this script, or stored words and searched words will stop lining up.
const nameTokens = (fullName) => [
  ...new Set(
    fullName
      .toLowerCase()
      .split(/[\s-]+/)
      .map((t) => t.trim())
      .filter(Boolean),
  ),
];

// Same words, whatever order they're stored in — order doesn't affect a search.
const sameWords = (a, b) =>
  Array.isArray(a) && a.length === b.length && b.every((t) => a.includes(t));

// Two reads in total rather than one per patient: users are keyed by their id.
const [patientSnap, userSnap] = await Promise.all([
  getDocs(collection(db, "patients")),
  getDocs(collection(db, "users")),
]);
const usersById = new Map(userSnap.docs.map((d) => [d.id, d.data()]));

const toFix = [];
const skipped = [];
let alreadyCorrect = 0;

for (const d of patientSnap.docs) {
  const p = d.data();
  if (p.userId == null || p.userId === "") {
    skipped.push({ id: d.id, reason: "the patient has no userId" });
    continue;
  }
  const user = usersById.get(String(p.userId));
  if (!user) {
    skipped.push({
      id: d.id,
      reason: `its linked user document (users/${p.userId}) doesn't exist`,
    });
    continue;
  }
  const fullName = [user.names, user.surname].filter(Boolean).join(" ").trim();
  const tokens = nameTokens(fullName);
  if (tokens.length === 0) {
    skipped.push({
      id: d.id,
      reason: `its linked user document (users/${p.userId}) has no name`,
    });
    continue;
  }
  if (sameWords(p.nameTokensLower, tokens)) {
    alreadyCorrect++;
    continue;
  }
  toFix.push({
    ref: d.ref,
    id: d.id,
    name: fullName,
    had: Array.isArray(p.nameTokensLower) ? p.nameTokensLower : null,
    tokens,
  });
}

console.log(`\nScanned ${patientSnap.size} patients.`);
console.log(`  ${alreadyCorrect} already have the right searchable name.`);
console.log(`  ${toFix.length} need it written or corrected.`);
console.log(`  ${skipped.length} skipped (listed below).\n`);

if (skipped.length > 0) {
  console.log(
    "SKIPPED — these can't be fixed from the data and need a person to look:\n",
  );
  for (const s of skipped) console.log(`  ${s.id}: ${s.reason}`);
  console.log("");
}

if (toFix.length === 0) {
  console.log("Nothing to write.");
  process.exit();
}

console.log("WILL UPDATE:\n");
for (const f of toFix) {
  const was = f.had ? `was ${JSON.stringify(f.had)}` : "none stored";
  console.log(
    `  ${f.id}  ${f.name}  ->  ${JSON.stringify(f.tokens)}  (${was})`,
  );
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = await rl.question(
  `\nType YES to write nameTokensLower on these ${toFix.length} patient(s): `,
);
rl.close();
if (answer.trim() !== "YES") {
  console.log("Cancelled. Nothing changed.");
  process.exit();
}

// Firestore allows 500 writes per batch; stay under it.
for (let i = 0; i < toFix.length; i += 400) {
  const batch = writeBatch(db);
  for (const f of toFix.slice(i, i + 400))
    batch.update(f.ref, { nameTokensLower: f.tokens });
  await batch.commit();
  console.log(`Wrote ${Math.min(i + 400, toFix.length)} of ${toFix.length}...`);
}

console.log(`\n${toFix.length} patient(s) updated.`);
process.exit();

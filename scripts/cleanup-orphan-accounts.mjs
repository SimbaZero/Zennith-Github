// Removes orphaned TEST accounts found by audit-clinic-mappings.mjs, and
// repairs the seeded `nurse` login.
//
// Deletes only the specific ids listed below — no pattern matching, no
// "delete anything that looks broken". Deletion has no undo, so this prints
// what it will do and waits for you to type YES.
//
// NOTE: this removes Firestore records only. The Firebase Auth logins for
// these accounts can only be deleted from the Firebase console — a client
// app can't delete other users. They'll be unable to load any data, which
// is the practical effect we want.
//
//   node scripts/cleanup-orphan-accounts.mjs
//
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
  query,
  updateDoc,
  where,
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

// Staff records with no clinic — created while testing Admin's Create User.
const STAFF_TO_DELETE = [];

// Login profiles to remove, by username.
const PROFILES_TO_DELETE = ["doctor3", "pharmacist3", "reception2"];

console.log("This will DELETE:\n");
for (const [col, id] of STAFF_TO_DELETE) console.log(`  ${col}/${id}`);
for (const u of PROFILES_TO_DELETE) console.log(`  profiles: "${u}"`);
console.log(
  `\nAnd REPAIR:\n  profiles: "nurse" -> relink to a real nurse record\n`,
);

const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = await rl.question("Type YES to proceed: ");
rl.close();
if (answer.trim() !== "YES") {
  console.log("Cancelled. Nothing changed.");
  process.exit();
}

console.log("");

for (const [col, id] of STAFF_TO_DELETE) {
  try {
    await deleteDoc(doc(db, col, id));
    console.log(`Deleted ${col}/${id}`);
  } catch (err) {
    console.log(`Could not delete ${col}/${id}: ${err.message}`);
  }
}

for (const username of PROFILES_TO_DELETE) {
  const snap = await getDocs(
    query(collection(db, "profiles"), where("username", "==", username)),
  );
  if (snap.empty) {
    console.log(`No profile "${username}" — already gone`);
    continue;
  }
  for (const d of snap.docs) {
    await deleteDoc(d.ref);
    console.log(`Deleted profile "${username}"`);
  }
}

// Repair the seeded nurse login: its legacyUserId points at a userId no
// nurse record has. Relink it to a real nurse rather than deleting it —
// this account is used for demos.
console.log("");
const nurseProfile = await getDocs(
  query(collection(db, "profiles"), where("username", "==", "nurse")),
);
if (nurseProfile.empty) {
  console.log('No profile "nurse" found.');
} else {
  const nurses = await getDocs(collection(db, "nurses"));
  // Prefer Nur-1 if it exists — that's the account demo data is built around.
  const target = nurses.docs.find((d) => d.id === "Nur-1") ?? nurses.docs[0];
  if (!target) {
    console.log("No nurse records exist to link to.");
  } else {
    const uid = Number(target.data().userId);
    await updateDoc(nurseProfile.docs[0].ref, { legacyUserId: uid });
    console.log(
      `Relinked profile "nurse" -> ${target.id} (userId ${uid}, clinicId ${target.data().clinicId})`,
    );
  }
}

console.log("\nDone. Re-run audit-clinic-mappings.mjs to confirm.");
process.exit();

// Read-only. Lists every admin/super_admin profile and which clinic it's
// scoped to, so you can decide what to keep. Changes nothing.
//
//   node scripts/list-admins.mjs
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

const clinicNames = new Map();
for (const d of (await getDocs(collection(db, "clinics"))).docs) {
  clinicNames.set(Number(d.data().clinicId), d.data().clinicName);
}

const snap = await getDocs(collection(db, "profiles"));
const admins = snap.docs.filter((d) =>
  ["admin", "super_admin"].includes(d.data().role),
);

console.log(`\n${admins.length} admin account(s):\n`);
for (const d of admins) {
  const p = d.data();
  const clinic =
    p.clinicId != null
      ? `${clinicNames.get(Number(p.clinicId)) ?? "unknown clinic"} (id ${p.clinicId})`
      : "— not scoped —";
  console.log(`  ${p.username}`);
  console.log(`    name:    ${p.fullName || "(none)"}`);
  console.log(`    role:    ${p.role}`);
  console.log(`    clinic:  ${clinic}`);
  console.log(`    seeded:  ${p.builtin ? "yes" : "no"}`);
  console.log(`    created: ${(p.createdAt ?? "unknown").slice(0, 10)}\n`);
}
process.exit();

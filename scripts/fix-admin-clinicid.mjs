// The seeded "admin" test login predates real clinic scoping and has no
// clinicId, so once Admin pages become clinic-scoped it would see nothing.
// Assigns it to a real clinic (defaults to clinicId 1, Hillbrow CHC).
// Deliberately does NOT touch superadmin — that account is meant to be
// platform-wide, not scoped to one clinic.
//
//   node scripts/fix-admin-clinicid.mjs
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
const auth = getAuth(app);
const db = getFirestore(app);
await signInWithEmailAndPassword(auth, "admin@zennith.test", "password");

const TARGET_CLINIC_ID = 1;

const clinicSnap = await getDoc(doc(db, "clinics", String(TARGET_CLINIC_ID)));
const clinicName = clinicSnap.exists()
  ? clinicSnap.data().clinicName
  : `Clinic ${TARGET_CLINIC_ID}`;

const snap = await getDocs(
  query(collection(db, "profiles"), where("role", "==", "admin")),
);

if (snap.empty) {
  console.log("No admin profiles found.");
} else {
  let updated = 0;
  for (const d of snap.docs) {
    const data = d.data();
    if (data.clinicId != null) {
      console.log(
        `${data.username}: already scoped to clinicId ${data.clinicId} — skipping`,
      );
      continue;
    }
    await updateDoc(doc(db, "profiles", d.id), { clinicId: TARGET_CLINIC_ID });
    console.log(
      `${data.username}: assigned to ${clinicName} (clinicId ${TARGET_CLINIC_ID})`,
    );
    updated++;
  }
  console.log(`\n${updated} admin profile(s) updated.`);
}
console.log("Done.");
process.exit();

// Fixes two gaps found while testing the pharmacist multi-clinic switcher:
//  1. The "pharmacist" test login only has one clinic — nothing to
//     actually switch between yet. Gives it a second real clinic.
//  2. That pharmacist's clinic has zero nurses, so Distribution can't
//     find anyone to give stock to. Moves one spare bulk-demo nurse
//     there — never Nur-1 or Nur-2, those are your real tested logins.
//
//   node scripts/fix-pharmacist-multiclinic-testdata.mjs
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

console.log(
  "=== Step 1: find the real pharmacist behind the 'pharmacist' login ===",
);
const profilesSnap = await getDocs(
  query(collection(db, "profiles"), where("username", "==", "pharmacist")),
);
if (profilesSnap.empty)
  throw new Error("No profile with username 'pharmacist' found.");
const profile = profilesSnap.docs[0].data();
if (profile.legacyUserId == null)
  throw new Error("That profile has no legacyUserId — nothing to link.");

const pharmSnap = await getDocs(
  query(
    collection(db, "pharmacists"),
    where("userId", "==", Number(profile.legacyUserId)),
  ),
);
if (pharmSnap.empty)
  throw new Error("No pharmacist record matches that userId.");
const pharmDoc = pharmSnap.docs[0];
const pharm = pharmDoc.data();
console.log(`Found ${pharm.pharmacistId}, primary clinicId ${pharm.clinicId}`);

const primaryClinicSnap = await getDoc(
  doc(db, "clinics", String(pharm.clinicId)),
);
const primaryClinicName = primaryClinicSnap.exists()
  ? primaryClinicSnap.data().clinicName
  : `Clinic ${pharm.clinicId}`;
console.log(`Primary clinic: ${primaryClinicName}`);

console.log("\n=== Step 2: give this pharmacist a second real clinic ===");
const clinicsSnap = await getDocs(collection(db, "clinics"));
const otherClinic = clinicsSnap.docs.find(
  (d) => Number(d.data().clinicId) !== Number(pharm.clinicId),
);
if (!otherClinic) {
  console.log("No other clinic exists to add — skipping.");
} else {
  const secondId = Number(otherClinic.data().clinicId);
  const secondName = otherClinic.data().clinicName;
  const existing = Array.isArray(pharm.clinicIds)
    ? pharm.clinicIds
    : [pharm.clinicId];
  if (existing.includes(secondId)) {
    console.log(`Already has ${secondName} — skipping.`);
  } else {
    await updateDoc(doc(db, "pharmacists", pharmDoc.id), {
      clinicIds: [...existing, secondId],
    });
    console.log(
      `Added ${secondName} (clinicId ${secondId}) — pharmacist now has 2 clinics.`,
    );
  }
}

console.log(`\n=== Step 3: check ${primaryClinicName} has nurses ===`);
const nursesAtPrimary = await getDocs(
  query(
    collection(db, "nurses"),
    where("clinicId", "==", Number(pharm.clinicId)),
  ),
);
if (!nursesAtPrimary.empty) {
  console.log(
    `${primaryClinicName} already has ${nursesAtPrimary.size} nurse(s) — nothing to do.`,
  );
} else {
  console.log(
    `${primaryClinicName} has 0 nurses. Finding a spare one to move...`,
  );
  const allNurses = await getDocs(collection(db, "nurses"));
  const spare = allNurses.docs.find(
    (d) => d.id !== "Nur-1" && d.id !== "Nur-2",
  );
  if (!spare) {
    console.log(
      "No spare nurse found to move — needs a real decision, not a script.",
    );
  } else {
    const oldClinicId = spare.data().clinicId;
    await updateDoc(doc(db, "nurses", spare.id), {
      clinicId: Number(pharm.clinicId),
    });
    console.log(
      `Moved ${spare.id} from clinicId ${oldClinicId} to ${primaryClinicName} (clinicId ${pharm.clinicId}).`,
    );
  }
}

console.log("\nDone.");
process.exit();

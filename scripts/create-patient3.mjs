// Creates a new, fully real patient account tied to Hillbrow CHC (clinicId 1) —
// real Firebase Auth login, real Firestore user/patient/medicalRecord docs.
// Safe to re-run (fixed IDs, well clear of any other range in use).
//
//   node scripts/create-patient3.mjs
//
import { readFileSync } from "node:fs";
import { initializeApp } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  getAuth,
  signInWithEmailAndPassword,
} from "firebase/auth";
import { doc, getFirestore, setDoc } from "firebase/firestore";

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

const EMAIL = "patient3@zennith.test";
const PASSWORD = "password";
const USER_ID = 12500;
const PATIENT_ID = "Pat-2500";
const RECORD_NO = 12500;

let uid;
try {
  const cred = await createUserWithEmailAndPassword(auth, EMAIL, PASSWORD);
  uid = cred.user.uid;
  console.log(`Created auth account for ${EMAIL}`);
} catch (e) {
  if (e.code === "auth/email-already-in-use") {
    const cred = await signInWithEmailAndPassword(auth, EMAIL, PASSWORD);
    uid = cred.user.uid;
    console.log(`${EMAIL} already existed — reusing it, refreshing its data`);
  } else {
    throw e;
  }
}

await setDoc(doc(db, "profiles", uid), {
  username: "patient3",
  role: "patient",
  fullName: "Karabo Sithole",
  patientId: PATIENT_ID,
  legacyUserId: USER_ID,
  createdAt: new Date().toISOString(),
  builtin: true,
});

await setDoc(doc(db, "users", String(USER_ID)), {
  userId: USER_ID,
  names: "Karabo",
  surname: "Sithole",
  role: "Patient",
  email: EMAIL,
  idNumber: "0402155800086",
  contactNum: "0821234500",
  city: "City of Johannesburg",
  suburb: "Hillbrow",
});

await setDoc(doc(db, "patients", PATIENT_ID), {
  patientId: PATIENT_ID,
  userId: USER_ID,
  clinicId: 1,
  medicalRecordNo: RECORD_NO,
  chronicCondition: "Hypertension",
  emergencyContactName: "Lindiwe Sithole",
  emergencyContactNo: "0821234501",
});

await setDoc(doc(db, "medicalRecords", String(RECORD_NO)), {
  medicalRecordNo: RECORD_NO,
  bloodType: "A+",
  allergies: "None recorded",
  bp: "128/82 mmHg",
  prescription: "Amlodipine 10mg",
  dosage: 10,
  lastVisit: new Date().toISOString(),
});

console.log(
  `\nDone. Log in as "patient3" / "password" — belongs to Hillbrow CHC.`,
);
process.exit();

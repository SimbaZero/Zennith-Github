// DESTRUCTIVE: reduces the imported dataset to a clean 10-account demo set whose
// usernames match their roles. Keeps the pharmacy inventory + one clinic.
//
//   node scripts/reset-to-demo.mjs
//
// After running, every account below logs in with password "password" and
// re-enrolls 2FA on first login. Old migrated logins (doc2_15, …) are disabled
// (their profiles are removed); delete their Auth records in the console if you
// want them gone entirely.
import { readFileSync } from "node:fs";
import { initializeApp } from "firebase/app";
import { createUserWithEmailAndPassword, getAuth, signInWithEmailAndPassword } from "firebase/auth";
import {
  collection, doc, getDocs, getFirestore, setDoc, writeBatch,
} from "firebase/firestore";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split(/\r?\n/).filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const app = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY, authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID, appId: env.VITE_FIREBASE_APP_ID,
});
const auth = getAuth(app);
const db = getFirestore(app);
const PW = "password";
const today = new Date();
const iso = (offsetDays, hhmm) => {
  const d = new Date(today); d.setDate(d.getDate() + offsetDays);
  return `${d.toISOString().slice(0, 10)}T${hhmm}:00.000Z`;
};
const retry = async (fn, n = 4) => {
  for (let i = 0; i < n; i++) {
    try { return await fn(); }
    catch (e) { if (i === n - 1) throw e; await new Promise((r) => setTimeout(r, 1500)); }
  }
};

// ---- the 10 kept accounts -------------------------------------------------
const PEOPLE = [
  { username: "doctor",       role: "doctor",       userId: 1,  names: "Sarah",   surname: "Mokoena",  detail: { col: "doctors",       id: "Doc-1",  extra: { doctorId: "Doc-1", specialisation: "General Practice", licenseNo: "MP100001" } } },
  { username: "doctor2",      role: "doctor",       userId: 2,  names: "James",   surname: "Naidoo",   detail: { col: "doctors",       id: "Doc-2",  extra: { doctorId: "Doc-2", specialisation: "Paediatrics", licenseNo: "MP100002" } } },
  { username: "nurse",        role: "nurse",        userId: 3,  names: "Thandi",  surname: "Dlamini",  detail: { col: "nurses",        id: "Nur-1",  extra: { nurseId: "Nur-1", clinicId: 1, specialisation: "Chronic Care" } } },
  { username: "nurse2",       role: "nurse",        userId: 4,  names: "Nomsa",   surname: "Khumalo",  detail: { col: "nurses",        id: "Nur-2",  extra: { nurseId: "Nur-2", clinicId: 1, specialisation: "Maternal Health" } } },
  { username: "patient",      role: "patient",      userId: 5,  names: "Sipho",   surname: "Ndlovu",   detail: { col: "patients",      id: "Pat-1",  extra: { patientId: "Pat-1", medicalRecordNo: 1, chronicCondition: "Type 2 Diabetes", emergencyContactName: "Lindiwe Ndlovu", emergencyContactNo: "0821110001" } } },
  { username: "patient2",     role: "patient",      userId: 6,  names: "Lerato",  surname: "Molefe",   detail: { col: "patients",      id: "Pat-2",  extra: { patientId: "Pat-2", medicalRecordNo: 2, chronicCondition: "Hypertension", emergencyContactName: "Kagiso Molefe", emergencyContactNo: "0821110002" } } },
  { username: "pharmacist",   role: "pharmacist",   userId: 7,  names: "David",   surname: "Pillay",   detail: { col: "pharmacists",   id: "Pharm-1", extra: { pharmacistId: "Pharm-1", licenseNo: "MP200001" } } },
  { username: "pharmacist2",  role: "pharmacist",   userId: 8,  names: "Grace",   surname: "Botha",    detail: { col: "pharmacists",   id: "Pharm-2", extra: { pharmacistId: "Pharm-2", licenseNo: "MP200002" } } },
  { username: "receptionist", role: "receptionist", userId: 9,  names: "Michael", surname: "van Wyk",  detail: { col: "receptionists", id: "Rec-1",  extra: { receptionistId: "Rec-1" } } },
  { username: "admin",        role: "admin",        userId: 10, names: "Admin",   surname: "User",     detail: null },
  // platform owner — sees every facility, not scoped to one
  { username: "superadmin",   role: "super_admin",  userId: 11, names: "Platform", surname: "Owner",   detail: null, facilityId: null },
];
// Staff/admin accounts are bound to a facility (clinic id from src/lib/clinic.ts);
// patients and the platform owner are not facility-scoped.
const DEFAULT_FACILITY = "hillbrow";
const facilityFor = (p) =>
  p.facilityId !== undefined ? p.facilityId : p.role === "patient" ? null : DEFAULT_FACILITY;
const emailFor = (u) => `${u}@zennith.test`;

// ---- Phase A: ensure Auth accounts, collect UIDs --------------------------
console.log("Phase A — ensuring the 10 Auth accounts…");
const keptUids = new Set();
for (const p of PEOPLE) {
  const email = emailFor(p.username);
  let uid;
  try { uid = (await retry(() => createUserWithEmailAndPassword(auth, email, PW))).user.uid; console.log("  created", p.username); }
  catch (e) {
    if (e.code === "auth/email-already-in-use") { uid = (await retry(() => signInWithEmailAndPassword(auth, email, PW))).user.uid; console.log("  exists ", p.username); }
    else throw e;
  }
  p.uid = uid; keptUids.add(uid);
}

// authenticated session for the Firestore work
await retry(() => signInWithEmailAndPassword(auth, "admin@zennith.test", PW));

// ---- Phase B: wipe --------------------------------------------------------
async function wipe(name, keepIds = new Set()) {
  const snap = await retry(() => getDocs(collection(db, name)));
  let batch = writeBatch(db), ops = 0, deleted = 0;
  for (const d of snap.docs) {
    if (keepIds.has(d.id)) continue;
    batch.delete(d.ref); ops++; deleted++;
    if (ops === 450) { await retry(() => batch.commit()); batch = writeBatch(db); ops = 0; }
  }
  if (ops > 0) await retry(() => batch.commit());
  console.log(`  wiped ${name} (${deleted})`);
}
console.log("Phase B — wiping imported bulk (keeping inventory)…");
const WIPE = ["users", "userCredentials", "patients", "doctors", "nurses", "pharmacists",
  "receptionists", "appointments", "medicalRecords", "medicalRecordsHistory",
  "distributions", "reorders", "notifications", "adminRecords", "clinics"];
for (const c of WIPE) await wipe(c);
await wipe("profiles", keptUids); // keep the 10 kept accounts' profiles, drop stale migrated ones

// ---- Phase C: rebuild clean linked data -----------------------------------
console.log("Phase C — writing clean demo data…");
const cap = (r) => r.charAt(0).toUpperCase() + r.slice(1);
for (const p of PEOPLE) {
  await setDoc(doc(db, "users", String(p.userId)), {
    userId: p.userId, names: p.names, surname: p.surname, role: cap(p.role),
    email: `${p.username}@zennith.test`, idNumber: `90010${String(p.userId).padStart(2, "0")}5800085`,
    contactNum: `08211100${String(p.userId).padStart(2, "0")}`, city: "City of Johannesburg", suburb: "Hillbrow",
  });
  if (p.detail) await setDoc(doc(db, p.detail.col, p.detail.id), { userId: p.userId, ...p.detail.extra });
  const fac = facilityFor(p);
  await setDoc(doc(db, "profiles", p.uid), {
    username: p.username, role: p.role, fullName: `${p.names} ${p.surname}`,
    email: `${p.username}@zennith.test`, legacyUserId: p.userId, builtin: true,
    createdAt: new Date().toISOString(),
    ...(fac ? { facilityId: fac } : {}),
  });
}

// one clinic
await setDoc(doc(db, "clinics", "1"), { clinicId: 1, clinicName: "Hillbrow CHC", Coordinates: "26.1946 S, 28.0473 E" });

// medical records for the two patients
await setDoc(doc(db, "medicalRecords", "1"), { medicalRecordNo: 1, bloodType: "O+", allergies: "Penicillin", bp: "130/85 mmHg", glucose: 8.4, cd4: null, viralLoad: null, prescription: "Metformin 850mg", dosage: 850, insurancePolicyNumber: null, lastVisit: iso(-3, "08:30") });
await setDoc(doc(db, "medicalRecords", "2"), { medicalRecordNo: 2, bloodType: "A+", allergies: "None recorded", bp: "145/95 mmHg", glucose: 5.6, cd4: null, viralLoad: null, prescription: "Amlodipine 10mg", dosage: 10, insurancePolicyNumber: "GEMS-4471", lastVisit: iso(-1, "09:15") });

// clinical notes
await setDoc(doc(db, "medicalRecordsHistory", "1"), { historyId: 1, medicalRecordNo: 1, patientId: "Pat-1", description: "Diabetes well controlled; continue Metformin and lifestyle plan." });
await setDoc(doc(db, "medicalRecordsHistory", "2"), { historyId: 2, medicalRecordNo: 2, patientId: "Pat-2", description: "Blood pressure elevated; Amlodipine dose increased, review in 4 weeks." });

// a handful of appointments incl. today so dashboards show live data
const APPTS = [
  { clinician: "Doc-1", patientId: "Pat-1", appointDateTime: iso(0, "09:00"), appointType: "Diabetic Review", status: "Scheduled" },
  { clinician: "Doc-1", patientId: "Pat-2", appointDateTime: iso(0, "10:30"), appointType: "Hypertension Review", status: "Scheduled" },
  { clinician: "Nur-1", patientId: "Pat-2", appointDateTime: iso(0, "11:00"), appointType: "Chronic Care Follow-up", status: "Scheduled" },
  { clinician: "Doc-2", patientId: "Pat-1", appointDateTime: iso(7, "14:00"), appointType: "Paediatric Follow-up", status: "Scheduled" },
  { clinician: "Nur-1", patientId: "Pat-1", appointDateTime: iso(-3, "08:30"), appointType: "Blood Pressure Check", status: "Completed" },
  { clinician: "Doc-1", patientId: "Pat-2", appointDateTime: iso(-10, "09:00"), appointType: "Consultation", status: "Completed" },
];
for (let i = 0; i < APPTS.length; i++) await setDoc(doc(db, "appointments", String(i + 1)), { appointmentId: i + 1, ...APPTS[i] });

console.log("\nDone. Clean demo set (password \"password\"):");
for (const p of PEOPLE) console.log(`  ${p.username.padEnd(13)} ${p.role.padEnd(12)} ${p.names} ${p.surname}`);
console.log("Kept: 12 inventory items, 1 clinic. Everyone re-enrolls 2FA on next login.");
process.exit();

// Additive: brings each collection up to 10 records for a fuller demo, WITHOUT
// touching the 10 role-linked login accounts or their linked rows. New records
// are data-only (no logins) — realistic for a clinic (many records, few logins).
//
//   node scripts/generate-demo-data.mjs
//
// Idempotent: uses fixed IDs, so re-running overwrites the generated rows.
import { readFileSync } from "node:fs";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { collection, doc, getDocs, getFirestore, writeBatch } from "firebase/firestore";

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
const retry = async (fn, n = 4) => {
  for (let i = 0; i < n; i++) { try { return await fn(); } catch (e) { if (i === n - 1) throw e; await new Promise((r) => setTimeout(r, 1500)); } }
};
await retry(() => signInWithEmailAndPassword(auth, "admin@zennith.test", "password"));

// deterministic RNG so the generated set is stable
let seed = 20260720;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0xffffffff; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const dt = (offsetDays, hhmm) => { const d = new Date(); d.setDate(d.getDate() + offsetDays); return `${d.toISOString().slice(0, 10)}T${hhmm}:00.000Z`; };
const hhmm = () => `${String(7 + Math.floor(rnd() * 11)).padStart(2, "0")}:${pick(["00", "15", "30", "45"])}`;

const FIRST = ["Thabo", "Lerato", "Sipho", "Naledi", "Bongani", "Lindiwe", "Themba", "Nomsa", "Kagiso", "Palesa", "Tshepo", "Zanele", "Mandla", "Refilwe", "Sibusiso", "Ayanda", "Vusi", "Nandi", "Andile", "Dimpho", "Katlego", "Boitumelo", "Lwazi", "Zinhle", "Mpho", "Karabo"];
const LAST = ["Nkosi", "Mokoena", "Dlamini", "Khumalo", "Ndlovu", "Molefe", "Sithole", "Mahlangu", "Zulu", "Naidoo", "Pillay", "Mthembu", "Radebe", "Ngcobo", "Maseko", "Cele", "Mabaso", "Tshabalala", "Sibeko", "Motaung"];
const CONDITIONS = ["Type 2 Diabetes", "Hypertension", "HIV", "Tuberculosis", "Asthma", "Epilepsy", "Chronic Kidney Disease", "Bipolar Disorder", "Rheumatoid Arthritis", "COPD"];
const DOC_SPEC = ["General Practice", "Paediatrics", "Cardiology", "Internal Medicine", "Family Medicine", "Psychiatry", "Nephrology", "Pulmonology"];
const NUR_SPEC = ["Chronic Care", "Maternal Health", "Paediatric Care", "HIV/TB Care", "Emergency Care", "Wound Care"];
const APPT_TYPES = ["Consultation", "Follow-up", "Chronic Care Follow-up", "Lab Review", "Medication Renewal", "New Patient", "Diabetic Review", "Hypertension Review"];
const NOTE_TEXT = ["Vitals stable, continue current regimen.", "Adherence counselling provided.", "Referred for lab tests.", "Dose adjusted; review in 4 weeks.", "Patient education on self-management.", "Blood pressure elevated, monitoring.", "Prescription refilled.", "Follow-up scheduled."];

const name = () => ({ names: pick(FIRST), surname: pick(LAST) });
const id13 = () => `9${Math.floor(rnd() * 9) }${String(Math.floor(rnd() * 1e11)).padStart(11, "0")}`.slice(0, 13);
const cell = () => `08${Math.floor(rnd() * 9)}${String(Math.floor(rnd() * 1e7)).padStart(7, "0")}`;

// read real inventory so distributions/reorders reference actual meds
const inv = (await retry(() => getDocs(collection(db, "inventory")))).docs.map((d) => ({ inventId: Number(d.data().inventId ?? d.id), medName: d.data().medName ?? "" }));

let batch = writeBatch(db), ops = 0, written = 0;
const put = (col, id, data) => {
  batch.set(doc(db, col, String(id)), data); ops++; written++;
  if (ops === 450) return retry(() => batch.commit()).then(() => { batch = writeBatch(db); ops = 0; });
};

// --- staff detail rows 3..10 (data-only, no logins), each with a users doc ----
// userId ranges chosen well clear of the login users (1..10)
async function addStaff(col, idField, prefix, specPool, userBase) {
  for (let i = 3; i <= 10; i++) {
    const uid = userBase + i;
    const n = name();
    await put("users", uid, { userId: uid, ...n, role: col === "doctors" ? "Doctor" : col === "nurses" ? "Nurse" : col === "pharmacists" ? "Pharmacist" : "Receptionist", email: "", idNumber: id13(), contactNum: cell(), city: "City of Johannesburg", suburb: pick(["Hillbrow", "Berea", "Yeoville", "Braamfontein"]) });
    const extra = { userId: uid, [idField]: `${prefix}-${i}` };
    if (col === "doctors" || col === "nurses") extra.specialisation = pick(specPool);
    if (col === "nurses") extra.clinicId = 1 + Math.floor(rnd() * 10);
    if (col === "doctors") extra.licenseNo = `MP${100000 + uid}`;
    if (col === "pharmacists") extra.licenseNo = `MP${200000 + uid}`;
    await put(col, `${prefix}-${i}`, extra);
  }
}
await addStaff("doctors", "doctorId", "Doc", DOC_SPEC, 200);
// receptionists need Rec-2..10 (only Rec-1 exists) — handle separately below
await addStaff("nurses", "nurseId", "Nur", NUR_SPEC, 300);
await addStaff("pharmacists", "pharmacistId", "Pharm", null, 400);
for (let i = 2; i <= 10; i++) {
  const uid = 500 + i; const n = name();
  await put("users", uid, { userId: uid, ...n, role: "Receptionist", email: "", idNumber: id13(), contactNum: cell(), city: "City of Johannesburg", suburb: pick(["Hillbrow", "Berea", "Yeoville"]) });
  await put("receptionists", `Rec-${i}`, { userId: uid, receptionistId: `Rec-${i}` });
}

// --- patients 3..10 + their users + medicalRecords -----------------------------
for (let i = 3; i <= 10; i++) {
  const uid = 100 + i; const n = name(); const cond = pick(CONDITIONS);
  await put("users", uid, { userId: uid, ...n, role: "Patient", email: "", idNumber: id13(), contactNum: cell(), city: "City of Johannesburg", suburb: pick(["Hillbrow", "Berea", "Yeoville", "Hospital Hill"]) });
  await put("patients", `Pat-${i}`, { patientId: `Pat-${i}`, userId: uid, medicalRecordNo: i, chronicCondition: cond, emergencyContactName: `${pick(FIRST)} ${n.surname}`, emergencyContactNo: cell() });
  await put("medicalRecords", i, {
    medicalRecordNo: i, bloodType: pick(["O+", "A+", "B+", "O-", "AB+"]), allergies: pick(["None recorded", "Penicillin", "Ibuprofen", "Sulfa drugs"]),
    bp: `${110 + Math.floor(rnd() * 40)}/${70 + Math.floor(rnd() * 25)} mmHg`, glucose: Number((4 + rnd() * 8).toFixed(1)),
    cd4: cond === "HIV" ? String(200 + Math.floor(rnd() * 1000)) : null, viralLoad: cond === "HIV" ? String(Math.floor(rnd() * 100)) : null,
    prescription: pick(inv).medName, dosage: pick([5, 10, 50, 100, 250, 500, 850]), insurancePolicyNumber: rnd() < 0.4 ? `GEMS-${1000 + Math.floor(rnd() * 9000)}` : null, lastVisit: dt(-Math.floor(rnd() * 60), hhmm()),
  });
}

// --- medicalRecordsHistory 3..10 (2 already exist) -----------------------------
for (let i = 3; i <= 10; i++) {
  const pat = 1 + Math.floor(rnd() * 10);
  await put("medicalRecordsHistory", i, { historyId: i, medicalRecordNo: pat, patientId: `Pat-${pat}`, description: pick(NOTE_TEXT) });
}

// --- appointments 7..10 (6 already exist) --------------------------------------
const clinicians = [...Array(10)].map((_, i) => `Doc-${i + 1}`).concat([...Array(10)].map((_, i) => `Nur-${i + 1}`));
for (let i = 7; i <= 10; i++) {
  await put("appointments", i, { appointmentId: i, appointDateTime: dt(pick([0, 0, 1, 2, 3, -2]), hhmm()), appointType: pick(APPT_TYPES), clinician: pick(clinicians), patientId: `Pat-${1 + Math.floor(rnd() * 10)}`, status: pick(["Scheduled", "Scheduled", "Completed"]) });
}

// --- distributions 1..10 -------------------------------------------------------
for (let i = 1; i <= 10; i++) {
  const m = pick(inv);
  await put("distributions", i, { distributionId: i, inventId: m.inventId, medName: m.medName, nurseName: `Nur-${1 + Math.floor(rnd() * 10)}`, unitsGiven: 5 + Math.floor(rnd() * 45), date: dt(-Math.floor(rnd() * 30), "00:00").slice(0, 10), createdAt: dt(-Math.floor(rnd() * 30), hhmm()) });
}

// --- reorders 1..10 ------------------------------------------------------------
for (let i = 1; i <= 10; i++) {
  const m = pick(inv);
  await put("reorders", i, { reorderId: i, inventId: m.inventId, medName: m.medName, requestedBy: `Pharm-${1 + Math.floor(rnd() * 10)}`, status: pick(["Pending", "Approved", "Delivered"]), date: dt(-Math.floor(rnd() * 20), "00:00").slice(0, 10) });
}

// --- notifications 1..10 -------------------------------------------------------
const NTITLES = ["Appointment Reminder", "Lab Results Ready", "Prescription Refill", "Follow-up Due", "Stock Alert", "Shift Update"];
for (let i = 1; i <= 10; i++) {
  await put("notifications", i, { notifId: i, userId: 1 + Math.floor(rnd() * 10), title: pick(NTITLES), message: "Please review this update in your dashboard.", isRead: rnd() < 0.5, timeSent: dt(-Math.floor(rnd() * 7), hhmm()) });
}

// --- clinics 2..10 (clinics/1 already exists) ----------------------------------
const CLINIC_NAMES = ["Berea CHC", "Yeoville Clinic", "Braamfontein CHC", "Cosmo City Clinic", "Soweto CHC", "Alexandra Clinic", "Diepsloot CHC", "Tembisa Clinic", "Katlehong CHC"];
for (let i = 2; i <= 10; i++) {
  await put("clinics", i, { clinicId: i, clinicName: CLINIC_NAMES[i - 2], Coordinates: `${(-26 - rnd()).toFixed(4)} S, ${(27.8 + rnd() * 0.5).toFixed(4)} E` });
}

// --- adminRecords 1..10 --------------------------------------------------------
for (let i = 1; i <= 10; i++) {
  await put("adminRecords", i, { adminRecordId: i, userIdAdded: 1 + Math.floor(rnd() * 10), timeStampCreated: dt(-Math.floor(rnd() * 90), hhmm()) });
}

if (ops > 0) await retry(() => batch.commit());
console.log(`Done. Wrote ${written} records. Each collection now holds ~10 rows (inventory stays at 12).`);
process.exit();

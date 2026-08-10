// Populates TWO demo clinics with real, dense data for Nurse-module demos —
// enough appointments/patients per clinic to actually see something on
// dashboards, instead of the thin/scattered spread generate-demo-data.mjs
// produces (that one spreads randomly across up to 10 clinics).
//
// Additive + idempotent: uses fixed IDs in a range well clear of anything
// else (Pat-2001.. / Pat-2101..), safe to re-run, doesn't touch or wipe
// anything from reset-to-demo.mjs or generate-demo-data.mjs.
//
// ONE deliberate mutation of existing data: reassigns nurse2 (Nur-2) from
// Hillbrow to a second clinic, so you get two genuinely separate nurse
// logins instead of two nurses on the same clinic.
//
//   node scripts/generate-nurse-demo-data.mjs
//
import { readFileSync } from "node:fs";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import {
  collection,
  doc,
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
const auth = getAuth(app);
const db = getFirestore(app);
const retry = async (fn, n = 4) => {
  for (let i = 0; i < n; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i === n - 1) throw e;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
};
await retry(() =>
  signInWithEmailAndPassword(auth, "admin@zennith.test", "password"),
);

let seed = 20260810;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0xffffffff;
};
const pick = (a) => a[Math.floor(rnd() * a.length)];
const dt = (offsetDays, hhmm) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.toISOString().slice(0, 10)}T${hhmm}:00.000Z`;
};
const hhmm = () =>
  `${String(7 + Math.floor(rnd() * 11)).padStart(2, "0")}:${pick(["00", "15", "30", "45"])}`;
const id13 = () =>
  `9${Math.floor(rnd() * 9)}${String(Math.floor(rnd() * 1e11)).padStart(11, "0")}`.slice(
    0,
    13,
  );
const cell = () =>
  `08${Math.floor(rnd() * 9)}${String(Math.floor(rnd() * 1e7)).padStart(7, "0")}`;

const FIRST = [
  "Thabo",
  "Lerato",
  "Sipho",
  "Naledi",
  "Bongani",
  "Lindiwe",
  "Themba",
  "Nomsa",
  "Kagiso",
  "Palesa",
  "Tshepo",
  "Zanele",
  "Mandla",
  "Refilwe",
  "Sibusiso",
  "Ayanda",
  "Vusi",
  "Nandi",
  "Andile",
  "Dimpho",
  "Katlego",
  "Boitumelo",
  "Lwazi",
  "Zinhle",
  "Mpho",
  "Karabo",
  "Nokuthula",
  "Sibongile",
  "Given",
  "Precious",
];
const LAST = [
  "Nkosi",
  "Mokoena",
  "Dlamini",
  "Khumalo",
  "Ndlovu",
  "Molefe",
  "Sithole",
  "Mahlangu",
  "Zulu",
  "Naidoo",
  "Pillay",
  "Mthembu",
  "Radebe",
  "Ngcobo",
  "Maseko",
  "Cele",
  "Mabaso",
  "Tshabalala",
  "Sibeko",
  "Motaung",
];
// Exact strings nurse.patients.tsx's MEDS_BY_CONDITION matches on — using
// anything else (e.g. "Type 2 Diabetes" like generate-demo-data.mjs does)
// silently produces an empty "Today's meds" column with no error.
const CONDITIONS = [
  "HIV",
  "AIDS",
  "TB",
  "Hypertension",
  "Diabetes Type 2",
  "Cardiac",
  "Chronic Kidney Disease",
];
const APPT_TYPES = [
  "Consultation",
  "Follow-up",
  "Chronic Care Follow-up",
  "Diabetic Review",
  "Hypertension Review",
  "Medication Renewal",
];
const NOTE_TEXT = [
  "Vitals stable, continue current regimen.",
  "Adherence counselling provided.",
  "Dose adjusted; review in 4 weeks.",
  "Blood pressure elevated, monitoring.",
  "Prescription refilled.",
];
const MEDS = [
  "Metformin 850mg",
  "Amlodipine 10mg",
  "TLD",
  "Rifafour",
  "Aspirin 100mg",
  "Furosemide 40mg",
];

const name = () => ({ names: pick(FIRST), surname: pick(LAST) });

let batch = writeBatch(db),
  ops = 0,
  written = 0;
const put = (col, id, data) => {
  batch.set(doc(db, col, String(id)), data);
  ops++;
  written++;
  if (ops === 450)
    return retry(() => batch.commit()).then(() => {
      batch = writeBatch(db);
      ops = 0;
    });
};

// --- two clinics -----------------------------------------------------------
// Clinic 1 (Hillbrow) already exists from reset-to-demo.mjs — left as-is.
// Clinic 2 is new/overwritten here with a clean, deliberate identity.
await put("clinics", 2, {
  clinicId: 2,
  clinicName: "Berea CHC",
  type: "public",
  Coordinates: "26.1889 S, 28.0518 E",
});

// --- the ONE mutation: reassign nurse2 to clinic 2 --------------------------
await put("nurses", "Nur-2", {
  userId: 4,
  nurseId: "Nur-2",
  clinicId: 2,
  specialisation: "Maternal Health",
});

// --- 30 patients per clinic --------------------------------------------------
const CLINICS = [
  {
    clinicId: 1,
    patientBase: 2000,
    userBase: 12000,
    recordBase: 12000,
    nurseId: "Nur-1",
    docId: "Doc-1",
  },
  {
    clinicId: 2,
    patientBase: 2100,
    userBase: 12100,
    recordBase: 12100,
    nurseId: "Nur-2",
    docId: "Doc-2",
  },
];

for (const c of CLINICS) {
  const patientIds = [];
  for (let i = 1; i <= 45; i++) {
    const uid = c.userBase + i;
    const patId = `Pat-${c.patientBase + i}`;
    const recNo = c.recordBase + i;
    const n = name();
    const cond = pick(CONDITIONS);
    patientIds.push({ patId, recNo });

    await put("users", uid, {
      userId: uid,
      ...n,
      role: "Patient",
      email: "",
      idNumber: id13(),
      contactNum: cell(),
      city: "City of Johannesburg",
      suburb: pick(["Hillbrow", "Berea", "Yeoville", "Braamfontein"]),
    });
    await put("patients", patId, {
      patientId: patId,
      userId: uid,
      clinicId: c.clinicId,
      medicalRecordNo: recNo,
      chronicCondition: cond,
      emergencyContactName: `${pick(FIRST)} ${n.surname}`,
      emergencyContactNo: cell(),
    });
    await put("medicalRecords", recNo, {
      medicalRecordNo: recNo,
      bloodType: pick(["O+", "A+", "B+", "O-", "AB+"]),
      allergies: pick([
        "None recorded",
        "Penicillin",
        "Ibuprofen",
        "Sulfa drugs",
      ]),
      bp: `${110 + Math.floor(rnd() * 40)}/${70 + Math.floor(rnd() * 25)} mmHg`,
      glucose: Number((4 + rnd() * 8).toFixed(1)),
      cd4:
        cond === "HIV" || cond === "AIDS"
          ? 200 + Math.floor(rnd() * 1000)
          : null,
      viralLoad:
        cond === "HIV" || cond === "AIDS" ? Math.floor(rnd() * 100) : null,
      prescription: pick(MEDS),
      dosage: pick([5, 10, 50, 100, 250, 500, 850]),
      insurancePolicyNumber:
        rnd() < 0.3 ? `GEMS-${1000 + Math.floor(rnd() * 9000)}` : null,
      lastVisit: dt(-Math.floor(rnd() * 21), hhmm()),
    });
    if (rnd() < 0.6) {
      await put(
        "medicalRecordsHistory",
        12000 + (c.clinicId === 1 ? 0 : 1000) + i,
        {
          historyId: 12000 + i,
          medicalRecordNo: recNo,
          patientId: patId,
          description: pick(NOTE_TEXT),
          visitDate: dt(-Math.floor(rnd() * 14), "00:00").slice(0, 10),
        },
      );
    }
  }

  // --- appointments spread across THIS week (Sun–Sat), so the new week
  // view actually has something to show, not just "today" ------------------
  let apptId = c.clinicId === 1 ? 12000 : 12100;
  for (const { patId } of patientIds) {
    if (rnd() < 0.5) continue; // not every patient has an upcoming appointment
    const dayOffset = Math.floor(rnd() * 7) - 3; // spread across ~this week
    await put("appointments", apptId, {
      appointmentId: apptId,
      appointDateTime: dt(dayOffset, hhmm()),
      appointType: pick(APPT_TYPES),
      clinician: rnd() < 0.5 ? c.nurseId : c.docId,
      patientId: patId,
      status: dayOffset < 0 ? pick(["Completed", "No-show"]) : "Scheduled",
    });
    apptId++;
  }

  // --- real, clinic-scoped inventory so Dispense has options at both clinics
  const stockMeds = [
    { name: "Metformin 850mg", cat: "Antidiabetic" },
    { name: "Amlodipine 10mg", cat: "Antihypertensive" },
    { name: "TLD", cat: "Antiretroviral" },
    { name: "Paracetamol 500mg", cat: "Analgesic" },
  ];
  stockMeds.forEach((m, i) => {
    put("inventory", 5000 + c.clinicId * 100 + i, {
      inventId: 5000 + c.clinicId * 100 + i,
      clinicId: c.clinicId,
      medName: m.name,
      category: m.cat,
      quantity: 50 + Math.floor(rnd() * 200),
      threshold: 40,
      lastUpdated: new Date().toISOString(),
    });
  });
}

if (ops > 0) await retry(() => batch.commit());
console.log(`Done. Wrote ${written} records across 2 clinics.\n`);
console.log('Demo logins (password: "password"):');
console.log(
  "  nurse      -> Thandi Dlamini  -> Hillbrow CHC  (clinicId 1) — 30 patients",
);
console.log(
  "  nurse2     -> Nomsa Khumalo   -> Berea CHC     (clinicId 2) — 30 patients",
);
console.log(
  "Each clinic also has its own real, scoped inventory stock for Dispense Medication to draw from.",
);
process.exit();

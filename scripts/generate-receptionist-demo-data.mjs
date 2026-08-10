// Reassigns the base `receptionist` account to Hillbrow (clinicId 1) and
// seeds a busier, more realistic walk-in queue — a mix of waiting/called/
// in-room entries PLUS several already-completed ("done") visits earlier
// today, so the Fast/Slow pace badge has real data to calculate from
// immediately, without needing anyone to click through statuses live.
// Additive, safe to re-run — fixed IDs.
//
//   node scripts/generate-receptionist-demo-data.mjs
//
import { readFileSync } from "node:fs";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { collection, doc, getFirestore, writeBatch } from "firebase/firestore";

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

const batch = writeBatch(db);
const now = new Date();
const minsAgo = (m) => new Date(now.getTime() - m * 60000).toISOString();

// The ONE mutation of existing data.
batch.set(
  doc(db, "receptionists", "Rec-1"),
  { receptionistId: "Rec-1", userId: 9, clinicId: 1 },
  { merge: true },
);

// Still-active entries — mix of triage levels and statuses.
const active = [
  {
    patientId: "Pat-2001",
    reason: "Chest pain",
    triage: "red",
    status: "waiting",
    joinedAt: minsAgo(3),
  },
  {
    patientId: "Pat-2005",
    reason: "Follow-up review",
    triage: "yellow",
    status: "waiting",
    joinedAt: minsAgo(9),
  },
  {
    patientId: "Pat-2009",
    reason: "Fever, general malaise",
    triage: "orange",
    status: "called",
    joinedAt: minsAgo(18),
    calledAt: minsAgo(2),
    clinician: "Nur-1",
  },
  {
    patientId: "Pat-2014",
    reason: "Medication renewal",
    triage: "green",
    status: "waiting",
    joinedAt: minsAgo(6),
  },
  {
    patientId: "Pat-2020",
    reason: "Wound dressing",
    triage: "yellow",
    status: "in-room",
    joinedAt: minsAgo(28),
    calledAt: minsAgo(12),
    inRoomAt: minsAgo(8),
    clinician: "Nur-1",
  },
  {
    patientId: "Pat-2003",
    reason: "Diabetic review",
    triage: "yellow",
    status: "waiting",
    joinedAt: minsAgo(4),
  },
  {
    patientId: "Pat-2011",
    reason: "Skin rash",
    triage: "green",
    status: "waiting",
    joinedAt: minsAgo(11),
  },
];

// Already-completed visits earlier today — real wait-to-called history so
// the pace badge (Fast/Normal/Slow) has something to average on load.
const done = [
  {
    patientId: "Pat-2002",
    reason: "Consultation",
    triage: "yellow",
    joinedAt: minsAgo(150),
    calledAt: minsAgo(140),
    doneAt: minsAgo(110),
  },
  {
    patientId: "Pat-2006",
    reason: "Follow-up",
    triage: "green",
    joinedAt: minsAgo(200),
    calledAt: minsAgo(185),
    doneAt: minsAgo(150),
  },
  {
    patientId: "Pat-2010",
    reason: "Medication renewal",
    triage: "yellow",
    joinedAt: minsAgo(240),
    calledAt: minsAgo(232),
    doneAt: minsAgo(200),
  },
  {
    patientId: "Pat-2015",
    reason: "Wound check",
    triage: "orange",
    joinedAt: minsAgo(90),
    calledAt: minsAgo(83),
    doneAt: minsAgo(70),
  },
  {
    patientId: "Pat-2019",
    reason: "Consultation",
    triage: "green",
    joinedAt: minsAgo(300),
    calledAt: minsAgo(270),
    doneAt: minsAgo(240),
  },
];

let i = 1;
for (const e of [...active]) {
  batch.set(doc(collection(db, "queue"), `Q-demo-${i++}`), {
    patientId: e.patientId,
    patientName: null,
    reason: e.reason,
    clinician: e.clinician ?? null,
    triage: e.triage,
    priority: e.triage === "red" || e.triage === "orange" ? "urgent" : "normal",
    status: e.status,
    joinedAt: e.joinedAt,
    calledAt: e.calledAt ?? null,
    facilityId: "1",
    handedOffTo: null,
    handedOffAt: null,
    handedOffBy: null,
    inRoomAt: e.inRoomAt ?? null,
    doneAt: null,
  });
}
for (const e of done) {
  batch.set(doc(collection(db, "queue"), `Q-demo-${i++}`), {
    patientId: e.patientId,
    patientName: null,
    reason: e.reason,
    clinician: "Nur-1",
    triage: e.triage,
    priority: "normal",
    status: "done",
    joinedAt: e.joinedAt,
    calledAt: e.calledAt,
    facilityId: "1",
    handedOffTo: null,
    handedOffAt: null,
    handedOffBy: null,
    inRoomAt: e.calledAt,
    doneAt: e.doneAt,
  });
}

await retry(() => batch.commit());
console.log(
  `Done. receptionist -> Hillbrow CHC. ${active.length} active + ${done.length} completed queue entries.`,
);
console.log('Log in as "receptionist" / "password" to see it.');
process.exit();

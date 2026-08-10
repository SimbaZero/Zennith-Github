// Reassigns the base `receptionist` account to Hillbrow (clinicId 1) — it
// had no clinicId set at all, so it was landing on a random clinic from
// the generic seed script. Once on clinicId 1, it automatically inherits
// the 30 patients + real appointment spread already seeded by
// generate-nurse-demo-data.mjs — nothing new needed for those. The only
// genuinely new thing here is real walk-in queue entries, since nothing
// has populated that collection yet.
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

// The ONE mutation of existing data — same pattern/warning as nurse2 before.
batch.set(
  doc(db, "receptionists", "Rec-1"),
  { receptionistId: "Rec-1", userId: 9, clinicId: 1 },
  { merge: true },
);

// Real walk-in queue entries at Hillbrow — mix of triage levels and
// statuses so the Dashboard actually looks like a working clinic, not an
// empty shell, for demo purposes.
const entries = [
  {
    patientId: "Pat-2001",
    reason: "Chest pain",
    triage: "red",
    status: "waiting",
    joinedAt: minsAgo(4),
  },
  {
    patientId: "Pat-2005",
    reason: "Follow-up review",
    triage: "yellow",
    status: "waiting",
    joinedAt: minsAgo(12),
  },
  {
    patientId: "Pat-2009",
    reason: "Fever, general malaise",
    triage: "orange",
    status: "called",
    joinedAt: minsAgo(22),
    calledAt: minsAgo(3),
    clinician: "Nur-1",
  },
  {
    patientId: "Pat-2014",
    reason: "Medication renewal",
    triage: "green",
    status: "waiting",
    joinedAt: minsAgo(8),
  },
  {
    patientId: "Pat-2020",
    reason: "Wound dressing",
    triage: "yellow",
    status: "in-room",
    joinedAt: minsAgo(35),
    calledAt: minsAgo(15),
    inRoomAt: minsAgo(10),
    clinician: "Nur-1",
  },
];

entries.forEach((e, i) => {
  batch.set(doc(collection(db, "queue"), `Q-demo-${i + 1}`), {
    patientId: e.patientId,
    patientName: null, // resolved live from the patients collection by the app
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
});

await retry(() => batch.commit());
console.log(
  "Done. receptionist account moved to clinicId 1 (Hillbrow CHC), 5 real walk-in queue entries added.",
);
console.log('Log in as "receptionist" / "password" to see it.');
process.exit();

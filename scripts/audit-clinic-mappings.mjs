// Read-only. Checks that every staff member points at a clinic that exists,
// and that their login profile agrees with their staff record.
//
// This is the team action item from the meeting — Nobuhle found a nurse whose
// profile and clinic didn't line up. Worth running before tightening security
// rules, because those rules will be built on these mappings: if a nurse's
// clinic is wrong, correct rules will still lock them out.
//
//   node scripts/audit-clinic-mappings.mjs
//
import { readFileSync } from "node:fs";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { collection, getDocs, getFirestore } from "firebase/firestore";

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

const load = async (name) => (await getDocs(collection(db, name))).docs;

const [clinics, profiles, doctors, nurses, pharmacists, receptionists] =
  await Promise.all([
    load("clinics"),
    load("profiles"),
    load("doctors"),
    load("nurses"),
    load("pharmacists"),
    load("receptionists"),
  ]);

const clinicIds = new Set(clinics.map((d) => Number(d.data().clinicId)));
const clinicName = new Map(
  clinics.map((d) => [Number(d.data().clinicId), d.data().clinicName]),
);

const problems = [];
const ROLES = [
  ["doctors", doctors, true],
  ["nurses", nurses, false],
  ["pharmacists", pharmacists, true],
  ["receptionists", receptionists, false],
];

console.log("=== Staff records ===\n");

for (const [name, docs, multiClinic] of ROLES) {
  let ok = 0;
  for (const d of docs) {
    const data = d.data();
    const id = d.id;
    const single = data.clinicId;
    const multi = Array.isArray(data.clinicIds) ? data.clinicIds : null;

    if (single == null && !multi) {
      problems.push(`${name}/${id}: no clinic assigned at all`);
      continue;
    }
    if (single != null && !clinicIds.has(Number(single))) {
      problems.push(
        `${name}/${id}: clinicId ${single} does not exist in clinics`,
      );
      continue;
    }
    if (multi) {
      const bad = multi.filter((c) => !clinicIds.has(Number(c)));
      if (bad.length) {
        problems.push(
          `${name}/${id}: clinicIds ${bad.join(", ")} do not exist in clinics`,
        );
        continue;
      }
      if (single != null && !multi.map(Number).includes(Number(single))) {
        problems.push(
          `${name}/${id}: clinicId ${single} is not in its own clinicIds [${multi.join(", ")}]`,
        );
        continue;
      }
    }
    if (multiClinic && !multi) {
      problems.push(
        `${name}/${id}: single-clinic only — has clinicId but no clinicIds (multi-clinic role)`,
      );
      continue;
    }
    if (data.userId == null) {
      problems.push(`${name}/${id}: no userId, can't be linked to a login`);
      continue;
    }
    ok++;
  }
  console.log(`${name}: ${ok}/${docs.length} clean`);
}

console.log("\n=== Login profiles vs staff records ===\n");

const staffByRole = {
  doctor: doctors,
  nurse: nurses,
  pharmacist: pharmacists,
  receptionist: receptionists,
};

let profilesOk = 0;
for (const p of profiles) {
  const data = p.data();
  const role = data.role;
  if (!role || role === "patient" || role === "super_admin") continue;

  if (role === "admin") {
    if (data.clinicId == null) {
      problems.push(`profiles/${data.username}: admin with no clinicId`);
    } else if (!clinicIds.has(Number(data.clinicId))) {
      problems.push(
        `profiles/${data.username}: admin clinicId ${data.clinicId} does not exist`,
      );
    } else {
      profilesOk++;
    }
    continue;
  }

  const docs = staffByRole[role];
  if (!docs) continue;

  if (data.legacyUserId == null) {
    problems.push(
      `profiles/${data.username} (${role}): no legacyUserId — login will fail on first data load`,
    );
    continue;
  }

  const match = docs.find(
    (d) => Number(d.data().userId) === Number(data.legacyUserId),
  );
  if (!match) {
    problems.push(
      `profiles/${data.username} (${role}): legacyUserId ${data.legacyUserId} matches no ${role} record`,
    );
    continue;
  }

  // The mismatch Nobuhle found: profile says one clinic, staff record says
  // another. Whichever page reads which source then disagrees.
  const staffClinic = match.data().clinicId;
  if (
    data.clinicId != null &&
    staffClinic != null &&
    Number(data.clinicId) !== Number(staffClinic)
  ) {
    problems.push(
      `profiles/${data.username} (${role}): profile says clinic ${data.clinicId} (${clinicName.get(Number(data.clinicId)) ?? "?"}) but ${match.id} says ${staffClinic} (${clinicName.get(Number(staffClinic)) ?? "?"})`,
    );
    continue;
  }
  profilesOk++;
}

console.log(`profiles: ${profilesOk} staff logins clean`);

console.log("\n=== Problems ===\n");
if (problems.length === 0) {
  console.log("None. All mappings consistent.");
} else {
  problems.forEach((p) => console.log("  • " + p));
  console.log(`\n${problems.length} issue(s). Nothing was changed.`);
}

process.exit();

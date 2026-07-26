// Creates real Firebase Auth logins from the imported dataset:
// joins userCredentials (userName/password) to users (role, names) by userId,
// creates an Auth account <userName>@zennith.test, and writes a profile doc
// at profiles/{authUid} that the app's login uses to resolve the role.
//
// Run:  node scripts/migrate-logins.mjs            (2 accounts per role)
//       node scripts/migrate-logins.mjs --all      (every credential row)
import { readFileSync } from "node:fs";
import { initializeApp } from "firebase/app";
import { createUserWithEmailAndPassword, getAuth, signInWithEmailAndPassword, updatePassword } from "firebase/auth";
import { collection, doc, getDocs, getFirestore, setDoc } from "firebase/firestore";

const PER_ROLE = process.argv.includes("--all") ? Infinity : 2;

// Most userCredentials rows store bcrypt HASHES, not passwords — a hash can't
// be reversed, so migrated demo accounts get this known password instead.
const DEMO_PASSWORD = "password123";
const isBcryptHash = (p) => /^\$2[aby]\$/.test(p);

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

const app = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
});
const auth = getAuth(app);
const db = getFirestore(app);

const VALID_ROLES = ["doctor", "nurse", "patient", "pharmacist", "receptionist", "admin"];

console.log("Reading users and userCredentials…");
const [usersSnap, credsSnap] = await Promise.all([
  getDocs(collection(db, "users")),
  getDocs(collection(db, "userCredentials")),
]);

const credByUserId = new Map();
for (const d of credsSnap.docs) {
  const c = d.data();
  if (c.userId != null && c.userName && c.password) credByUserId.set(Number(c.userId), c);
}

// Group importable people by role, keeping dataset order (ascending userId).
const byRole = new Map();
for (const d of usersSnap.docs) {
  const u = d.data();
  const role = String(u.role ?? "").toLowerCase();
  const userId = Number(u.userId ?? d.id);
  if (!VALID_ROLES.includes(role)) continue;
  if (!credByUserId.has(userId)) continue;
  if (!byRole.has(role)) byRole.set(role, []);
  byRole.get(role).push({ ...u, userId });
}

console.log(
  `Found ${credsSnap.size} credentials, ${usersSnap.size} users. ` +
    `Migrating up to ${Number.isFinite(PER_ROLE) ? PER_ROLE : "ALL"} per role.\n`,
);

const created = [];
for (const [role, people] of [...byRole.entries()].sort()) {
  const picked = people.sort((a, b) => a.userId - b.userId).slice(0, PER_ROLE);
  for (const person of picked) {
    const cred = credByUserId.get(person.userId);
    const username = String(cred.userName).toLowerCase();
    // some rows store a full email as the userName — use it as-is
    const email = username.includes("@") ? username : `${username}@zennith.test`;
    const storedPw = String(cred.password);
    const password = isBcryptHash(storedPw) || storedPw.length < 6 ? DEMO_PASSWORD : storedPw;
    const profile = {
      username,
      role,
      fullName: [person.names, person.surname].filter(Boolean).join(" "),
      email: person.email ?? "",
      legacyUserId: person.userId,
      createdAt: new Date().toISOString(),
      builtin: false,
    };
    try {
      const c = await createUserWithEmailAndPassword(auth, email, password);
      await setDoc(doc(db, "profiles", c.user.uid), profile);
      created.push({ username, password, role, name: profile.fullName });
      console.log(`created ${username} (${role}) — ${profile.fullName}`);
    } catch (e) {
      if (e.code === "auth/email-already-in-use") {
        try {
          let c;
          try {
            c = await signInWithEmailAndPassword(auth, email, password);
          } catch {
            // account was created in an earlier run with the raw hash as its
            // password — sign in with the hash and repair it
            c = await signInWithEmailAndPassword(auth, email, storedPw);
            await updatePassword(c.user, password);
          }
          await setDoc(doc(db, "profiles", c.user.uid), profile);
          created.push({ username, password, role, name: profile.fullName });
          console.log(`exists  ${username} (${role}) — profile/password refreshed`);
        } catch {
          console.error(`FAILED  ${username} — account exists but its password is unknown`);
        }
      } else {
        console.error(`FAILED  ${username}: ${e.code ?? e.message}`);
        process.exitCode = 1;
      }
    }
  }
}

if (created.length) {
  console.log("\nReady to log in (username / password / role):");
  for (const c of created) console.log(`  ${c.username} / ${c.password} / ${c.role}  (${c.name})`);
} else {
  console.log("\nNo accounts migrated — check the warnings above.");
}
const missingRoles = VALID_ROLES.filter((r) => !byRole.has(r));
if (missingRoles.length)
  console.log(
    `\nNo importable people found for role(s): ${missingRoles.join(", ")}.` +
      `\nRun "node scripts/seed-users.mjs" if you also want the six demo role accounts.`,
  );
process.exit();

// Seeds the six built-in role accounts into Firebase Auth + Firestore.
// Usernames map to <role>@zennith.test, matching toEmail() in src/lib/auth.ts.
// Prerequisites (Firebase console): Email/Password sign-in enabled, Firestore created.
// Run: node scripts/seed-users.mjs
import { readFileSync } from "node:fs";
import { initializeApp } from "firebase/app";
import { createUserWithEmailAndPassword, getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { doc, getFirestore, setDoc } from "firebase/firestore";

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

const ROLES = ["doctor", "nurse", "patient", "pharmacist", "receptionist", "admin"];
const PASSWORD = "password";

const profile = (role) => ({
  username: role,
  role,
  fullName: role.charAt(0).toUpperCase() + role.slice(1),
  createdAt: new Date().toISOString(),
  builtin: true,
});

for (const role of ROLES) {
  const email = `${role}@zennith.test`;
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, PASSWORD);
    await setDoc(doc(db, "profiles", cred.user.uid), profile(role));
    console.log(`created ${role} (${email})`);
  } catch (e) {
    if (e.code === "auth/email-already-in-use") {
      // Ensure the profile doc exists even if the auth account was created before.
      try {
        const cred = await signInWithEmailAndPassword(auth, email, PASSWORD);
        await setDoc(doc(db, "profiles", cred.user.uid), profile(role));
        console.log(`exists  ${role} (${email}) — profile refreshed`);
      } catch {
        console.error(
          `FAILED  ${role}: ${email} already exists with a different password. ` +
            `Delete it under Authentication → Users in the Firebase console, then rerun.`,
        );
        process.exitCode = 1;
      }
    } else {
      console.error(`FAILED  ${role}: ${e.code ?? e.message}`);
      process.exitCode = 1;
    }
  }
}
console.log(`\nDone. Log in with the role name as username (e.g. "doctor") and password "${PASSWORD}".`);
process.exit();

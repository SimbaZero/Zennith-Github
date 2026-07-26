// Additive: creates (or repairs) the platform-owner account used by the
// /super-admin module. Does not touch any other data.
//
//   node scripts/create-superadmin.mjs
//
// Login: username "superadmin", password "password" (2FA enrolls on first login).
import { readFileSync } from "node:fs";
import { initializeApp } from "firebase/app";
import { createUserWithEmailAndPassword, getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { doc, getFirestore, setDoc } from "firebase/firestore";

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

const EMAIL = "superadmin@zennith.test";
const PW = "password";

const profile = {
  username: "superadmin",
  role: "super_admin",
  fullName: "Platform Owner",
  email: EMAIL,
  builtin: true,
  createdAt: new Date().toISOString(),
  // platform owner is deliberately NOT facility-scoped
};

let uid;
try {
  uid = (await createUserWithEmailAndPassword(auth, EMAIL, PW)).user.uid;
  console.log("created auth account:", EMAIL);
} catch (e) {
  if (e.code === "auth/email-already-in-use") {
    uid = (await signInWithEmailAndPassword(auth, EMAIL, PW)).user.uid;
    console.log("auth account already existed:", EMAIL);
  } else {
    console.error("FAILED:", e.code ?? e.message);
    process.exit(1);
  }
}
await setDoc(doc(db, "profiles", uid), profile);
console.log('profile written — sign in with username "superadmin" / password "password"');
process.exit(0);

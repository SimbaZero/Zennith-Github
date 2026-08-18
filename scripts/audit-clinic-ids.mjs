// Read-only audit: checks clinicId completeness across doctors/nurses/
// pharmacists/receptionists, and legacyUserId completeness across
// profiles. Makes no writes at all — safe to run anytime, as often as
// you want, gives you a real current answer instead of a manual count.
//
//   node scripts/audit-clinic-ids.mjs
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

async function checkClinicId(collectionName) {
  const snap = await getDocs(collection(db, collectionName));
  const total = snap.size;
  const missing = [];
  snap.forEach((d) => {
    const clinicId = d.data().clinicId;
    if (clinicId == null || typeof clinicId !== "number") missing.push(d.id);
  });
  return { total, missingCount: missing.length, missing };
}

async function checkLegacyUserId() {
  const snap = await getDocs(collection(db, "profiles"));
  const total = snap.size;
  const missing = [];
  snap.forEach((d) => {
    const data = d.data();
    const legacyUserId = data.legacyUserId;
    if (legacyUserId == null || typeof legacyUserId !== "number") {
      missing.push(
        `${d.id} (username: ${data.username ?? "unknown"}, role: ${data.role ?? "unknown"})`,
      );
    }
  });
  return { total, missingCount: missing.length, missing };
}

console.log("=== clinicId audit ===\n");
for (const col of ["doctors", "nurses", "pharmacists", "receptionists"]) {
  const r = await checkClinicId(col);
  console.log(`${col}: ${r.total - r.missingCount}/${r.total} have clinicId`);
  if (r.missing.length) console.log(`  Missing in: ${r.missing.join(", ")}`);
}

console.log("\n=== legacyUserId audit (profiles collection) ===\n");
const p = await checkLegacyUserId();
console.log(
  `profiles: ${p.total - p.missingCount}/${p.total} have legacyUserId`,
);
if (p.missing.length) {
  console.log(`  Missing in:`);
  p.missing.forEach((m) => console.log(`    - ${m}`));
}

console.log("\nDone.");
process.exit();

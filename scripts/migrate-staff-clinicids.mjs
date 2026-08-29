// One-time (but safe to re-run) migration: adds a new `clinicIds` array
// field to every doctor and pharmacist, seeded from their existing
// `clinicId` value. Does NOT touch or remove `clinicId` — nothing that
// reads the old field breaks. Skips any doc that already has `clinicIds`,
// so running this twice is harmless.
//
//   node scripts/migrate-staff-clinicids.mjs
//
import { readFileSync } from "node:fs";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import {
  collection,
  getDocs,
  getFirestore,
  doc,
  updateDoc,
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

async function migrate(collectionName) {
  const snap = await getDocs(collection(db, collectionName));
  let updated = 0;
  let skipped = 0;
  const noClinicId = [];

  for (const d of snap.docs) {
    const data = d.data();
    if (Array.isArray(data.clinicIds)) {
      skipped++;
      continue;
    }
    if (typeof data.clinicId !== "number") {
      noClinicId.push(d.id);
      continue;
    }
    await updateDoc(doc(db, collectionName, d.id), {
      clinicIds: [data.clinicId],
    });
    updated++;
  }

  return { total: snap.size, updated, skipped, noClinicId };
}

console.log("=== clinicIds migration ===\n");
for (const col of ["doctors", "pharmacists"]) {
  const r = await migrate(col);
  console.log(
    `${col}: ${r.updated} updated, ${r.skipped} already had clinicIds`,
  );
  if (r.noClinicId.length) {
    console.log(
      `  ⚠️  No clinicId at all, could not migrate: ${r.noClinicId.join(", ")}`,
    );
  }
}

console.log("\nDone.");
process.exit();

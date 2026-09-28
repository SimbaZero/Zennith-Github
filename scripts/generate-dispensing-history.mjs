// Seeds 30 days of plausible dispensing history so the pharmacy forecasting
// has something to work from.
//
// Writes to `patientDispensing` — what nurses actually hand to patients, and
// what useMedicationUsage reads. Deliberately does NOT decrease inventory:
// the stock on hand is the current real figure, and the point here is to give
// the forecast a usage rate, not to rewrite stock history.
//
// Volumes are worked BACKWARDS from current stock, so the forecasts come out
// believable instead of "121 units a day against 47 in stock":
//   1. Read each medication's real quantity from `inventory`.
//   2. Pick a target days-of-stock: chronic medication 25–45 days of cover,
//      acute 15–30, anything else 20–40.
//   3. Daily rate = on hand / target days; total = rate × 30.
//   4. Spread that total over the 30 days — busier early in the week, quiet
//      weekends — rounded so the days add up exactly to the total.
// Runs for every active clinic in `clinics`. Per clinic, one medication is
// deliberately set to land in "Order now" and one or two in "Reorder soon",
// so a demo shows the urgent states without everything being on fire.
// Out-of-stock items already show "Order now".
//
// Every row written carries `seeded: true`. Each run first deletes the rows
// it wrote before (and only those), so re-running replaces the history rather
// than stacking on top of it. Deterministic: the same inventory gives the
// same figures on every run.
//
//   node scripts/generate-dispensing-history.mjs               seed
//   node scripts/generate-dispensing-history.mjs --dry-run     print plan only
//   node scripts/generate-dispensing-history.mjs --purge-legacy
//
// --purge-legacy: rows written by the OLD version of this script have no
// `seeded` marker. They're recognisable because their dispenseId is the
// script's run time (Date.now()) while createdAt is backdated up to 30 days —
// a real dispense stamps both within seconds (dispensing refuses to run
// offline). With this flag those rows are deleted too. Run it once; after
// that the `seeded` marker is enough.
//
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Must match buildForecasts in src/lib/pharmacist-service.ts — only used here
// to print what status each medication should land in.
const LEAD_TIME_DAYS = 3;
const SAFETY_DAYS = 4;

const DAYS = 30;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Pure planning — no Firestore. Exported so it can be checked offline.
// ---------------------------------------------------------------------------

// Deterministic 32-bit hash of a string (FNV-1a), used to seed a PRNG per
// clinic + medication so results don't depend on iteration order.
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Small seeded PRNG (mulberry32).
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function kindOf(name) {
  const n = name.toLowerCase();
  if (
    /lamivudine|tenofovir|dolutegravir|efavirenz|tdf|dtg|tld|arv|metformin|insulin|mixtard|glic|amlodipine|hydrochloro|enalapril|valproate|phenytoin|carbamazepine/.test(
      n,
    )
  )
    return "chronic";
  if (
    /paracetamol|panado|ibuprofen|analges|antihistamine|chlorphenamine|cetirizine|loratadine|allerg|amoxicillin|antibiotic/.test(
      n,
    )
  )
    return "acute";
  return "other";
}

const TARGET_DAYS = {
  chronic: [25, 45],
  acute: [15, 30],
  other: [20, 40],
};
// Deliberate urgent states. "Order now" = at or under the supplier lead time;
// "Reorder soon" = under the reorder point (lead time + safety stock = 7
// days) but above the lead time.
const CRITICAL_DAYS = 2;
const REORDER_DAYS = 5.5;
// An urgent state is only forced on a medication whose stock makes it
// believable: pushing 900 paracetamol into "Reorder soon" would take 164 a
// day, which is exactly the kind of figure this script exists to avoid.
const MAX_URGENT_RATE = 40;
// An item with 0 on hand can't be worked backwards from; give it a modest
// rate so it reads as "Order now" rather than "No usage data".
const OUT_OF_STOCK_RATE = { chronic: 4, acute: 2, other: 2 };

// Relative busyness by weekday (0 = Sunday). Monday catches the weekend's
// backlog; Saturday is a half day; Sunday is emergencies only.
const WEEKDAY_WEIGHT = [0.1, 1.3, 1.15, 1.0, 1.0, 0.9, 0.3];

/**
 * @param meds   [{ name, inventId, onHand }] for one clinic
 * @param clinicId
 * @param now    Date — the end of the 30-day window
 * @returns [{ ...med, kind, role, targetDays, rate, total, perDay[30],
 *             expectedStatus }] with perDay oldest-first.
 */
export function planClinic(meds, clinicId, now) {
  const stocked = meds.filter((m) => m.onHand > 0);
  const hasOutOfStock = meds.some((m) => m.onHand <= 0);

  // Deterministic pick of which medications to make urgent. Prefer ones that
  // make a sensible demo story, then fall back to hash order. Items with very
  // little stock are skipped (a rate worked back from 3 units is noise), as
  // are items with so much stock the forced rate would be implausible.
  const byHash = (a, b) =>
    hash(`${clinicId}:${a.name}`) - hash(`${clinicId}:${b.name}`);
  const eligible = (targetDays) =>
    stocked
      .filter((m) => m.onHand >= 20 && m.onHand / targetDays <= MAX_URGENT_RATE)
      .sort(byHash);
  const pickFirst = (targetDays, re, exclude) => {
    const pool = eligible(targetDays).filter((m) => !exclude.has(m));
    return pool.find((m) => re.test(m.name.toLowerCase())) ?? pool[0];
  };

  const roles = new Map();
  const taken = new Set();
  if (!hasOutOfStock) {
    const c = pickFirst(CRITICAL_DAYS, /insulin|mixtard/, taken);
    if (c) {
      roles.set(c, "critical");
      taken.add(c);
    }
  }
  const reorderCount = stocked.length >= 6 ? 2 : 1;
  for (let i = 0; i < reorderCount; i++) {
    const r = pickFirst(
      REORDER_DAYS,
      /paracetamol|metformin|amlodipine/,
      taken,
    );
    if (!r) break;
    roles.set(r, "reorder");
    taken.add(r);
  }

  // Day keys oldest-first, matching useMedicationUsage's 30-day window.
  const days = [];
  for (let back = DAYS - 1; back >= 0; back--) {
    const d = new Date(now);
    d.setDate(d.getDate() - back);
    days.push(d);
  }

  return meds.map((m) => {
    const kind = kindOf(m.name);
    const rand = prng(hash(`${clinicId}:${m.name}`));
    const role = m.onHand <= 0 ? "out" : (roles.get(m) ?? "normal");

    const [lo, hi] = TARGET_DAYS[kind];
    const targetDays =
      role === "critical"
        ? CRITICAL_DAYS
        : role === "reorder"
          ? REORDER_DAYS
          : role === "out"
            ? 0
            : Math.round(lo + rand() * (hi - lo));
    const rate =
      role === "out" ? OUT_OF_STOCK_RATE[kind] : m.onHand / targetDays;
    const total = Math.round(rate * DAYS);

    // Weekday shape with ±15% day-to-day jitter, then largest-remainder
    // rounding so the whole days sum exactly to `total`.
    const weights = days.map(
      (d) => WEEKDAY_WEIGHT[d.getDay()] * (0.85 + rand() * 0.3),
    );
    const wSum = weights.reduce((a, b) => a + b, 0);
    const raw = weights.map((w) => (total * w) / wSum);
    const perDay = raw.map(Math.floor);
    const short = total - perDay.reduce((a, b) => a + b, 0);
    raw
      .map((r, i) => [r - Math.floor(r), i])
      .sort((a, b) => b[0] - a[0] || a[1] - b[1])
      .slice(0, short)
      .forEach(([, i]) => perDay[i]++);

    // What buildForecasts should make of it.
    const avg = total / DAYS;
    const daysLeft = avg > 0 ? m.onHand / avg : null;
    const reorderPoint = Math.ceil(avg * (LEAD_TIME_DAYS + SAFETY_DAYS));
    const expectedStatus =
      daysLeft == null
        ? "No usage data"
        : daysLeft <= LEAD_TIME_DAYS
          ? "Order now"
          : m.onHand <= reorderPoint
            ? "Reorder soon"
            : "Healthy";

    return {
      ...m,
      kind,
      role,
      targetDays,
      rate,
      total,
      perDay,
      days,
      daysLeft,
      expectedStatus,
    };
  });
}

/** Split a day's units into individual dispensing events. Chronic scripts
 *  are bigger (a month's supply) and fewer; acute ones are small. */
export function splitIntoEvents(units, kind, rate) {
  const size =
    kind === "chronic"
      ? Math.min(30, Math.max(1, Math.round(rate / 6)))
      : Math.min(5, Math.max(1, Math.round(rate / 4)));
  const events = [];
  let left = units;
  while (left > 0) {
    const n = Math.min(size, left);
    events.push(n);
    left -= n;
  }
  return events;
}

// ---------------------------------------------------------------------------
// Firestore side — only runs when executed directly.
// ---------------------------------------------------------------------------

async function main() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has("--dry-run");
  const purgeLegacy = args.has("--purge-legacy");

  const { initializeApp } = await import("firebase/app");
  const { getAuth, signInWithEmailAndPassword } = await import("firebase/auth");
  const {
    collection,
    getDocs,
    getFirestore,
    query,
    where,
    writeBatch,
    doc,
    Timestamp,
  } = await import("firebase/firestore");

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

  // Batched writer that commits every 400 operations.
  let batch = writeBatch(db);
  let inBatch = 0;
  const flush = async () => {
    if (inBatch > 0 && !dryRun) await batch.commit();
    batch = writeBatch(db);
    inBatch = 0;
  };
  const queue = async (fn) => {
    fn(batch);
    if (++inBatch >= 400) await flush();
  };

  const now = new Date();
  let written = 0;

  // Every active clinic, not a hardcoded list — a clinic missing here shows
  // "No usage data" on the pharmacist pages. Same rule as listClinics() in
  // clinic-data.ts: only an explicit "pending" (unapproved application) is
  // inactive; the original pre-loaded clinics have no status field at all.
  const clinicSnap = await getDocs(collection(db, "clinics"));
  const clinics = clinicSnap.docs
    .map((d) => d.data())
    .filter(
      (c) => c.status !== "pending" && Number.isFinite(Number(c.clinicId)),
    )
    .map((c) => ({
      clinicId: Number(c.clinicId),
      clinicName: c.clinicName ?? `Clinic ${c.clinicId}`,
    }))
    .sort((a, b) => a.clinicId - b.clinicId);
  console.log(
    `Seeding ${clinics.length} active clinic(s): ${clinics.map((c) => c.clinicName).join(", ")}\n`,
  );

  for (const { clinicId, clinicName } of clinics) {
    const [invSnap, patSnap, nurseSnap, dispSnap] = await Promise.all([
      getDocs(
        query(collection(db, "inventory"), where("clinicId", "==", clinicId)),
      ),
      getDocs(
        query(collection(db, "patients"), where("clinicId", "==", clinicId)),
      ),
      getDocs(
        query(collection(db, "nurses"), where("clinicId", "==", clinicId)),
      ),
      getDocs(
        query(
          collection(db, "patientDispensing"),
          where("clinicId", "==", clinicId),
        ),
      ),
    ]);

    // 1. Remove this script's previous rows so history doesn't stack.
    const ours = dispSnap.docs.filter((d) => d.data().seeded === true);
    const legacy = dispSnap.docs.filter((d) => {
      const x = d.data();
      if (x.seeded === true) return false;
      const created = x.createdAt?.toMillis?.();
      const id = Number(x.dispenseId);
      return (
        created != null && Number.isFinite(id) && id - created > ONE_DAY_MS
      );
    });
    const toDelete = purgeLegacy ? [...ours, ...legacy] : ours;
    for (const d of toDelete) await queue((b) => b.delete(d.ref));
    await flush();
    console.log(
      `${clinicName} (clinic ${clinicId}): ${dryRun ? "would delete" : "deleted"} ${ours.length} seeded row(s)` +
        (purgeLegacy ? ` and ${legacy.length} legacy row(s)` : "") +
        ".",
    );
    if (!purgeLegacy && legacy.length > 0)
      console.log(
        `  ⚠ ${legacy.length} unmarked row(s) look like they came from the old version of this script` +
          " and will still count towards usage. Re-run with --purge-legacy to remove them.",
      );

    // 2. Current stock, summed per medication name (the forecast matches
    //    dispensing to stock by name).
    const byName = new Map();
    for (const d of invSnap.docs) {
      const x = d.data();
      if (!x.medName) continue;
      const q = Number(x.quantity);
      const prev = byName.get(x.medName);
      byName.set(x.medName, {
        name: x.medName,
        inventId: prev?.inventId ?? Number(x.inventId),
        onHand: (prev?.onHand ?? 0) + (Number.isFinite(q) ? q : 0),
      });
    }
    const meds = [...byName.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    const patients = patSnap.docs.map((d) => d.id).sort();
    const nurses = nurseSnap.docs.map((d) => d.id).sort();

    if (meds.length === 0 || patients.length === 0) {
      console.log(`  No inventory or patients — skipped.`);
      continue;
    }

    // 3. Plan and write.
    const plan = planClinic(meds, clinicId, now);
    console.table(
      plan.map((p) => ({
        medication: p.name,
        onHand: p.onHand,
        kind: p.kind,
        role: p.role,
        perDay: Math.round((p.total / DAYS) * 10) / 10,
        daysLeft: p.daysLeft == null ? "—" : Math.round(p.daysLeft * 10) / 10,
        expected: p.expectedStatus,
      })),
    );

    for (const p of plan) {
      const rand = prng(hash(`events:${clinicId}:${p.name}`));
      for (let i = 0; i < DAYS; i++) {
        const events = splitIntoEvents(p.perDay[i], p.kind, p.rate);
        for (const units of events) {
          const when = new Date(p.days[i]);
          // Clinic hours, roughly 8am to 4pm.
          when.setHours(
            8 + Math.floor(rand() * 8),
            Math.floor(rand() * 60),
            0,
            0,
          );
          // Today's events can't be in the future.
          if (when > now)
            when.setTime(now.getTime() - (1 + rand() * 60) * 60000);

          const patientId = patients[Math.floor(rand() * patients.length)];
          const nurseId = nurses[Math.floor(rand() * nurses.length)] ?? "Nur-1";
          await queue((b) =>
            b.set(doc(collection(db, "patientDispensing")), {
              // Derived from createdAt, so it's stable and doesn't carry the
              // run-time signature the legacy purge looks for.
              dispenseId: when.getTime() + written,
              patientId,
              clinicId,
              medName: p.name,
              inventId: p.inventId,
              unitsGiven: units,
              nurseId,
              note: null,
              createdAt: Timestamp.fromDate(when),
              seeded: true,
            }),
          );
          written++;
        }
      }
    }
    await flush();
  }

  console.log(
    `\n${dryRun ? "Would write" : "Wrote"} ${written} dispensing events across ${DAYS} days.`,
  );
  if (!dryRun)
    console.log(
      "Reload the pharmacist Stock or Medication Overview page to see the forecasts.",
    );
  process.exit();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();

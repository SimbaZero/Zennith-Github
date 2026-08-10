# Zennith — Firestore Issues & Decisions To Raise With The Team

Running log of things found while wiring the backend to real Firestore data.
Update this file as we go — don't lose track of anything before raising it with Simba/the DB owner.

_Last major update: Aug 2026. Two things happened in this pass: (1) the Nurse module work below, and (2) a numbering fix — several code comments across the Receptionist module already pointed to entries #16/#17/#18 in this file that had never actually been written here. Backfilled them from what the code itself shows was fixed, and moved the Nurse items that had accidentally reused those same numbers up to #20+. If you wrote the original #16/#17/#18 fixes and the backfilled description below doesn't match what you actually intended, please correct it — it's reconstructed from code comments, not from your original notes._

---

## ✅ Resolved since this doc was last updated (Nurse module)

Quick summary for anyone catching up — full detail stays in the sections below where relevant.

- Nurse profile resolution silently fell back to a hardcoded **"Nur-1"** — a different real nurse's name/clinic — whenever a signed-in nurse's own profile link was missing or broken. Now throws a clear error instead of borrowing someone else's identity. (`src/lib/nurse-service.ts`)
- Digitize (OCR) flow: saving a scan with a blank medication field crashed outright — Firestore rejects `undefined` field values. Fixed.
- Digitize flow: new patients created via OCR scan were written with **no `clinicId`** — same bug class as #16 below, just on a different write path. Fixed.
- Nurse Patients page and Patient-ID search were **not scoped to clinic at all**. Both now scoped to the signed-in nurse's own `clinicId`. Needed a new Firestore composite index (`patients`: `clinicId` Asc + `userId` Asc) — created and confirmed Enabled.
- That same list had **no error handling at all** on its live query — a failed query just hung on "Loading patients…" forever with nothing shown. Now surfaces a real error message, and clears it automatically once the query succeeds.
- Sidebar/header on all Nurse pages showed a hardcoded "Hillbrow CHC" and a placeholder name instead of the real signed-in nurse's name and real clinic.
- OCR extraction quality was very poor on handwritten forms using Tesseract.js — replaced with a Gemini Vision prototype. **See #23 below — explicitly a placeholder, not a finished decision.**
- Real in-browser camera capture (desktop + mobile) added to Digitize.
- Patient Record page (`PatientRecordView.tsx`, shared by Nurse + Doctor) was 100% read-only. Nurse now has Edit Record (clinical fields only — identity stays locked), append-only Clinical Notes, and Dispense Medication (new `patientDispensing` collection, see #20).
- Real, downloadable PDF for the Medical Record page (`src/lib/pdf-export.ts`, via `jsPDF`) — previously "Download PDF" just called `window.print()`.
- Nurse Appointments page rebuilt: real Sunday–Saturday week view, calendar date picker, Prev/Next week navigation, empty days grayed out.

## ✅ Also checked this pass: Receptionist and Patient modules

You asked whether Receptionist had the same class of issues Nurse did — mostly good news:

- **Receptionist's patient browsing (`Profiles` page) and live walk-in queue are both already properly clinic/facility-scoped, and both already have real error handling** (TanStack Query's `isError` on Profiles; a visible error message on the queue). Nothing to fix there.
- **But the Patient-ID search box (`findPatient()`) has no clinic check at all** — see new #24 below. Same gap Nurse's ID search had before it was fixed.
- **Patient module (`patient-service.ts`)** — at least 8 live Firestore subscriptions (patient doc, linked user, medical record, clinic, appointments, notifications, visit history, and one more) have **no error handling at all**. None of them are compound queries, so they're unlikely to hit the missing-index problem specifically, but they will fail silently (permission errors, network issues) with zero feedback to the patient using the app. See new #25 below.

---

## 🐞 Bugs (things that are actually wrong / inconsistent)

### 1. `inventory.quantity` is stored as a string, not a number

- **Where:** `inventory` collection, `quantity` field.
- **Problem:** Some/most documents have `quantity: "120"` (string) instead of a real number, while `threshold` is correctly numeric.
- **Current workaround:** Forced through `Number(...)`/`toNumber()` everywhere it's used — `pharmacist-service.ts` and now `nurse-service.ts` (`dispenseMedication`, `useClinicInventory`) both do this consistently.
- **Ask the team:** Standardize `quantity` (and similar numeric fields) to always be written as a real Firestore **number**.

---

## 🧩 Design Gaps (missing pieces, not necessarily "bugs")

### 2. `inventory.clinicId` — **the documented decision no longer matches the real data**

- **Where:** `inventory` collection.
- **What this doc used to say:** "Confirmed with the team — inventory is a single central pharmacist stock, no `clinicId` field."
- **What's actually in Firestore now (confirmed directly in Firebase Console, Aug 2026):** Real inventory documents **do** have a `clinicId` field, and it's what the new Nurse Dispense Medication feature relies on (`useClinicInventory(clinicId)`).
- **Ask the team, urgently:** Is `inventory` genuinely per-clinic now? If so, `pharmacist-service.ts`'s `useInventory()` should be updated to filter by clinic too — it still fetches the _entire_ collection with no filter, same "fetch everything" problem Nurse just spent real effort fixing elsewhere. Not touched yet — Pharmacist module isn't in scope this sprint.

### 3. No `avgDay` (average daily usage) field on `inventory`

- Unchanged — see prior note.

### 4. No ID counter for `distributions` — and now also for `patientDispensing`

- **Where:** `counters` collection has no entry for either collection's IDs.
- Both use `Date.now()` as a placeholder ID. Works, just not as tidy as the sequential IDs elsewhere.
- **Ask the team:** Decide if either needs a real sequential counter (same transaction pattern `registerPatient` already uses).

### 5. No "pending / awaiting confirmation" state for distributions

- Unchanged — see prior note.

### 6. Clinics matched by name string, not ID

- Unchanged — see prior note.

### 12. `pharmacists` has no `clinicId` — unlike `nurses`

- Unchanged. Worth re-reading alongside #2 — if inventory really is per-clinic now, this is more urgent, not less.

### 13. New distribution writes are missing the `inventId` field

- Unchanged — see prior note.

### 16. Receptionist registration was silently dropping `clinicId`, `DOB`, and `Gender` — **FIXED**

- **Where:** `registerPatient()` in `clinic-data.ts`, and the `RegistrationInput` type.
- **What was wrong:** Three separate fields were collected on the registration form but never actually written to Firestore — walk-in-registered patients ended up with no `clinicId` at all (meaning they'd vanish from any clinic-scoped view — the exact bug class that also hit Nurse's Digitize flow separately, see the Nurse section above), and `users.DOB` / `users.Gender` were captured on the form and silently discarded.
- **Status: fixed.** `RegistrationInput` now carries `clinicId`, `dob`, and `gender`, and `registerPatient()` writes all three.
- _(Backfilled from code comments — the fix predates this doc entry existing.)_

### 17. Walk-in queue wasn't filtered by facility — every clinic saw every other clinic's queue — **FIXED**

- **Where:** `subscribeQueue()` / `fetchQueue()` in `clinic-data.ts`.
- **What was wrong:** The live queue subscription always queried the _entire_ `queue` collection with no facility filter, even though every entry already stores a `facilityId`.
- **Status: fixed.** Both functions now accept an optional `facilityId` and filter by it; `receptionist.index.tsx` passes the receptionist's real facility.
- _(Backfilled from code comments — the fix predates this doc entry existing.)_

### 18. Queue audit log had the same unfiltered-by-facility problem — **FIXED**

- **Where:** `fetchQueueAudit()` in `clinic-data.ts`, used by the Receptionist dashboard's activity log.
- **Status: fixed**, same pattern and same fix as #17, paired together in the same commit per the code comments.
- _(Backfilled from code comments — the fix predates this doc entry existing.)_

### 19. Receptionist's patient browse list wasn't scoped to clinic either — **FIXED, separate from #17/#18**

- **Where:** `fetchPatientPage()` in `clinic-data.ts`, used by `receptionist.profiles.tsx`.
- **Note:** the in-code comment on this fix also cites "#17," which is why this looked like the same issue as the queue fix above at first glance — it isn't; it's a different collection/query (`patients`, not `queue`), fixed the same way (an optional `clinicId` filter). Giving it its own number here so future code comments can be precise about which one they mean.
- **Status: fixed.** Scoped to `clinicId`, with a proper `isError`/`isLoading` state already wired into the UI.

### 20. **`patientDispensing`** — new collection, nurse dispenses medication directly to a patient

- **Where:** brand-new collection, added by the Nurse module (Dispense Medication).
- **Why it's separate from `distributions`:** `distributions` is pharmacist → **nurse** (no `patientId` field exists on it at all). `patientDispensing` is nurse → **patient**, a genuinely different event.
- **Fields:** `dispenseId` (placeholder, see #4), `patientId`, `clinicId`, `medName`, `inventId`, `unitsGiven`, `nurseId`, `note` (optional free text, deliberately not a hardcoded enum yet), `createdAt`.
- **Safety:** decrements `inventory.quantity` and writes the log entry in a single Firestore transaction — two nurses dispensing the same medication at the same moment can't both succeed past real stock. (`distributions`' existing `recordDistribution()` does its two writes _without_ a transaction, for comparison.)
- **Ask the team:** decide if `note` should become a structured field (e.g. `visitType`) once the real clinical workflow is confirmed.

### 21. `MedicalRecordUpdateInput` doesn't declare `lastVisit`, even though real documents have it

- **Where:** `clinic-data.ts`.
- **Context:** Editing a patient's chart or dispensing medication now both stamp `medicalRecords.lastVisit` — but the type doesn't list that field, so the code uses `as any` to reach around it in `PatientRecordView.tsx`.
- **Ask the team / fix (small, low-risk):** add `lastVisit?: string;` to the interface, remove the cast.

### 22. Edits via Edit Record / Dispense Medication don't live-refresh the Nurse Patients list

- **Where:** Nurse → Patients page.
- **Context:** after editing a chart or dispensing, the Patients list shows stale data until a manual refresh — unlike most other Nurse data, which already uses live `onSnapshot` listeners.
- **Confirmed acceptable for now** (team decision, Aug 2026) — not blocking, worth tightening later.

### 24. **Receptionist's Patient-ID search has no clinic check** — same gap Nurse had, not yet fixed here

- **Where:** `findPatient()` in `clinic-data.ts`, used by `receptionist.profiles.tsx`'s search box.
- **Problem:** unlike the browse list (#19, properly scoped), this direct-ID lookup fetches by document ID with no clinic filter at all. A receptionist can type any exact `Pat-###` ID — including one from a different clinic — and it loads that patient's summary regardless.
- **Status: open.** Same fix pattern already applied to Nurse's `useFindPatientById()` — check the fetched doc's `clinicId` against the receptionist's own, treat a mismatch as not-found.

### 25. Patient module: 8 live Firestore listeners have no error handling at all

- **Where:** `patient-service.ts` — subscriptions covering the patient's own doc, linked user doc, medical record, clinic, appointments, notifications, and visit history.
- **Problem:** none of them pass an error callback to `onSnapshot`. A failed subscription (permission error, network issue) fails completely silently — no error shown, data just never appears or never updates, with nothing telling the patient something's wrong.
- **Status: open.** None of these are compound queries, so they're unlikely to need a Firestore index the way the Nurse patient list did — this is purely about adding visible error handling, same pattern as the fix already applied to `usePatientDirectory()`.

## 🤖 AI / OCR — Nurse Digitize

### 23. Gemini Vision is a **prototype**, not a finished decision — two real gaps, not one

- **Where:** `src/lib/gemini-ocr.ts`.
- **Why it replaced Tesseract.js:** Tesseract performed very poorly on handwritten clinic files in real testing (as low as 24% confidence). Gemini's multimodal vision handled the same sample meaningfully better. `src/lib/ocr.ts` (the old Tesseract module) has been deleted — confirmed unused anywhere in the app.
- **Gap 1 — data privacy / free tier:** Gemini's free tier allows Google to use submitted prompts/images to improve their products — real patient data should not go through it. **Current mitigation:** tested with fake/synthetic patients only, code marked `TODO(compliance)`.
- **Gap 2 — API key exposure:** no backend exists, so the key ships in the client bundle (`VITE_GEMINI_API_KEY`). Marked `TODO(security)`.
- **Ask the team, before any real patient data goes through this:** move the call behind a real backend (a Cloud Function would solve both gaps at once), and/or move to Gemini's paid tier.

---

## 🔐 Auth / Login Decisions

### 7. 2FA is still a demo placeholder, not real

- Unchanged — see prior note.

### 8. No age, gender, or patient "status" field

- **Partially resolved for Gender/DOB on new registrations** — see #16 above; `users.DOB` and `users.Gender` are now actually written for new patients registered through Receptionist. Older/pre-existing patient records may still be missing these. A patient "status" field is still fully undecided.

### 9. `medicalRecordsHistory` has no date field

- **Partially addressed for new Nurse-written notes** — new Clinical Notes and Digitize entries now include a `visitDate`. Older rows still don't.

### 10. Medical Aid details have no backing collection

- Unchanged — see prior note.

### 11. `notifications` has no "type" field

- Unchanged — see prior note.

### 14. "Reset 2FA" button is a deliberate dev-only bypass

- Unchanged. **Repeating the warning:** must be removed or gated before any real deployment.

### 15. Password reset emails use Firebase's default (unbranded) template

- Unchanged — see prior note.

---

## ✅ Confirmed working / good design (no action needed)

- Firestore connection, config, and security rules (`allow read, write: if request.auth != null`) all work correctly.
- Collections are otherwise sensibly modeled and match real clinical/pharmacist workflows.
- Anonymous Auth is currently enabled for local testing only — **must be disabled before production**. Repeating this loudly since it's the single biggest gap in the whole app right now.
- New composite Firestore index (`patients`: `clinicId` Asc + `userId` Asc) confirmed created and **Enabled** — required for the Nurse clinic-scoping work.
- Receptionist's walk-in queue and patient-browse list: real clinic/facility scoping, real error handling, nothing to fix.

---

## 🧭 Open decisions summary (quick-scan for a team meeting)

1. Is `inventory` really per-clinic now? (#2 — blocks a clean answer on Pharmacist scoping)
2. Should `patientDispensing.note` become a structured field? (#20)
3. Move Gemini OCR behind a backend and/or to paid tier before any real patient photo goes through it (#23) — **do this before any real deployment, not optional**
4. Disable Anonymous Auth and tighten Firestore security rules before real deployment (repeated from "Confirmed working" — it's not actually "working," it's a known open gap being tracked loosely)
5. Remove/gate the "Reset 2FA" dev bypass before real deployment (#14)
6. **`doctors.clinicId` and `pharmacists.clinicId` are both a single value, not a list** — the schema currently assumes one staff member belongs to exactly one clinic. Team confirmed a doctor (and separately, a pharmacist) may realistically need to work across more than one clinic — the login page's "Active Clinic" selector and the header's clinic switcher (currently used by Pharmacist/Super Admin) are both non-functional placeholders sitting on top of this same gap. Needs a real schema decision (e.g. `clinicIds: number[]`, or a separate join collection) before any real "switch clinic" feature can be built — not something to fake on top of a single-clinic field.
7. Fix Receptionist's `findPatient()` clinic-scoping gap (#24) — same class of fix already applied to Nurse
8. Add error handling to Patient module's 8 unguarded Firestore listeners (#25)

---

_(Keep adding to this as we find more — nothing gets fixed silently, everything goes here first. If you're adding a new numbered entry, grep the codebase first for `db-issues.md #<number>` to make sure nothing's already secretly pointing at that number — that's exactly the mistake that needed fixing this time.)_

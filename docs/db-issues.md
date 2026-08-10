# Zennith — Firestore Issues & Decisions To Raise With The Team

Running log of things found while wiring the backend to real Firestore data.
Update this file as we go — don't lose track of anything before raising it with Simba/the DB owner.

_Last major update: Aug 2026, after the Nurse module (OCR digitize, appointments, patient records, Dispense Medication) was wired to real Firestore._

---

## ✅ Resolved since this doc was last updated (Nurse module)

Quick summary for anyone catching up — full detail stays in the sections below where relevant.

- Nurse profile resolution silently fell back to a hardcoded **"Nur-1"** — a different real nurse's name/clinic — whenever a signed-in nurse's own profile link was missing or broken. Now throws a clear error instead of borrowing someone else's identity. (`src/lib/nurse-service.ts`)
- Digitize (OCR) flow: saving a scan with a blank medication field crashed outright — Firestore rejects `undefined` field values, and the write wasn't guarding against that. Fixed.
- Digitize flow: new patients created via OCR scan were written with **no `clinicId`** — same bug class as an earlier Receptionist fix (`registerPatient`'s `clinicId` was available but never passed through on this path). Fixed.
- Nurse Patients page and Patient-ID search were **not scoped to clinic at all** — fetched across every clinic in the DB, and a nurse could look up any patient's full record by guessing/typing a `Pat-###` ID from a different clinic. Both the browse list and the ID search are now scoped to the signed-in nurse's own `clinicId`. **Needed a new Firestore composite index** (`patients`: `clinicId` Asc + `userId` Asc) — created and confirmed Enabled.
- That same list had **no error handling at all** on its live query — a failed query (e.g. the missing index above) just hung on "Loading patients…" forever with nothing shown. Now surfaces a real error message in the UI, and clears it automatically once the query succeeds.
- Sidebar/header on all Nurse pages showed a hardcoded "Hillbrow CHC" and a placeholder name instead of the real signed-in nurse's name and real clinic (pulled from `nurses` → `clinics` join, same pattern already used for Receptionist).
- OCR extraction quality was very poor on handwritten forms using Tesseract.js (confidence as low as 24%) — replaced with a Gemini Vision prototype for OCR + field extraction. **See the new "AI / OCR" section below — this is explicitly a placeholder, not a finished decision.**
- Real in-browser camera capture (desktop + mobile, via `getUserMedia`) added to Digitize — previously only opened a native file picker.
- Patient Record page (`PatientRecordView.tsx`, shared by Nurse + Doctor) was 100% read-only. Nurse now has:
  - **Edit Record** — clinical fields only (condition, blood type, allergies, prescription, dosage, BP, glucose, CD4, viral load). Identity/registration fields (name, ID number, contact, address, emergency contact, insurance) stay locked — that's Receptionist/Admin territory.
  - **Append-only Clinical Notes** — a nurse can add a new note, never edit/delete an old one (matches how `handoverEntries` already works elsewhere).
  - **Dispense Medication** — see new collection `patientDispensing` below.
  - Doctor's version of the same shared page is untouched — still read-only.
- Real, downloadable PDF for the Medical Record page (`src/lib/pdf-export.ts`, via `jsPDF`) — previously "Download PDF" just called `window.print()`.
- Nurse Appointments page rebuilt: real Sunday–Saturday week view (separate from the shared Monday-start week logic Doctor's pages still use — deliberately not touched), a real calendar date picker, Prev/Next week navigation, and days with zero appointments now show visually grayed-out instead of requiring a click to find out they're empty.

---

## 🐞 Bugs (things that are actually wrong / inconsistent)

### 1. `inventory.quantity` is stored as a string, not a number

- **Where:** `inventory` collection, `quantity` field
- **Problem:** Some/most documents have `quantity: "120"` (string) instead of `quantity: 120` (number), while `threshold` is correctly stored as a number. This breaks any math done directly on the field.
- **Current workaround:** `pharmacist-service.ts` and the new `nurse-service.ts` (`dispenseMedication`, `useClinicInventory`) both force `quantity` through a `Number(...)` conversion before use. Safe permanent workaround, applied consistently in both places now — but the underlying data should still be standardized at the source.
- **Ask the team:** Standardize `quantity` (and double check `threshold` and similar numeric fields across other collections) to always be written as a real Firestore **number** type.

---

## 🧩 Design Gaps (missing pieces, not necessarily "bugs")

### 2. `inventory.clinicId` — **the documented decision no longer matches the real data**

- **Where:** `inventory` collection
- **What this doc used to say:** "Confirmed with the team — inventory is a single central pharmacist stock, no `clinicId` field, clinic-level breakdown only exists via `distributions` records."
- **What's actually in Firestore now (confirmed directly in Firebase Console, Aug 2026):** Real inventory documents **do** have a `clinicId` field (e.g. `clinicId: 1` on Hillbrow's antihistamine/Lamivudine stock). Either this changed since the original decision, or the original "central pool" read of the schema was wrong.
- **What was built on top of this (Nurse Dispense Medication):** `useClinicInventory(clinicId)` in `nurse-service.ts` queries `inventory` filtered by `clinicId`, on the assumption that this field is real and populated. It works today — but it directly contradicts the design decision recorded in this file.
- **Ask the team, urgently — this needs a real decision, not another workaround:** Is `inventory` actually per-clinic now, or was `clinicId` added to some documents inconsistently? If it's genuinely per-clinic, **`pharmacist-service.ts`'s `useInventory()` should be updated to filter by clinic too** — right now it still fetches the _entire_ collection with no clinic filter at all, which is the same "fetch everything" problem the Nurse module just spent a lot of effort fixing elsewhere. Not touched yet because the Pharmacist module isn't in scope this sprint — flagging so it isn't missed when that module starts.

### 3. No `avgDay` (average daily usage) field on `inventory`

- **Where:** `inventory` collection
- **Context:** `pharmacist.stock.tsx` displays an "Avg/day" figure per medication. Doesn't exist in Firestore yet.
- **Current workaround:** Temporarily faked/hardcoded with a `// TODO(db):` comment — see `pharmacist-service.ts`.
- **Ask the team:** Decide whether this should be (a) a real stored field, or (b) calculated from `distributions`/`patientDispensing` history.

### 4. No ID counter for `distributions` — and now also for `patientDispensing`

- **Where:** `counters` collection only tracks `patientNo`, `recordNo`, `userNo` — nothing for distributions, and nothing for the new `patientDispensing` collection either.
- **Current workaround:** Both `distributions.distributionId` and the new `patientDispensing.dispenseId` use `Date.now()` (a timestamp) instead of a clean sequential number. Works fine functionally.
- **Ask the team:** Decide if a real sequential counter is wanted for either/both — would need a Firestore transaction to increment safely, same pattern as `registerPatient`'s use of the `counters` collection.

### 5. No "pending / awaiting confirmation" state for distributions

- Unchanged from before — see prior note. Not touched by the Nurse module work.

### 6. Clinics matched by name string, not ID

- Unchanged from before — see prior note. Not touched by the Nurse module work.

### 12. `pharmacists` has no `clinicId` — unlike `nurses`

- Unchanged from before. Worth re-reading alongside #2 above — if inventory really is per-clinic now, this becomes more urgent, not less.

### 13. New distribution writes are missing the `inventId` field

- Unchanged from before — not touched by the Nurse module work.

### 16. **New collection: `patientDispensing`** — nurse dispenses medication directly to a patient

- **Where:** brand-new collection, added by the Nurse module (Dispense Medication feature on the Patient Record page).
- **Why it's separate from `distributions`:** `distributions` is a _different_ real-world workflow — pharmacist gives central/clinic stock to a **nurse** (no `patientId` field exists on it at all, confirmed by reading `pharmacist-service.ts`). `patientDispensing` is nurse → **patient**, a genuinely different event. Reusing `distributions` for this would have conflated two different things.
- **Fields written:** `dispenseId` (placeholder, see #4 above), `patientId`, `clinicId`, `medName`, `inventId`, `unitsGiven`, `nurseId`, `note` (optional free text — e.g. "scheduled appointment" vs "acute/walk-in"; deliberately left as free text rather than a hardcoded enum, since the real clinical workflow distinction wasn't fully confirmed), `createdAt`.
- **Safety:** Decrements `inventory.quantity` and writes the log entry in a single Firestore transaction, so two nurses dispensing the same medication at the same moment can't both succeed past the real stock level (`distributions`' existing `recordDistribution()` does the same two writes _without_ a transaction — worth knowing if that one ever needs to be bulletproof too).
- **Ask the team:** Decide if `note` should become a real structured field (e.g. `visitType: "appointment" | "acute"`) once the actual clinical workflow is confirmed, rather than staying free text.

### 17. `medicalRecordUpdateInput` doesn't declare `lastVisit`, even though real documents have it

- **Where:** `clinic-data.ts`, `MedicalRecordUpdateInput` interface.
- **Context:** Editing a patient's chart (Edit Record) or dispensing medication to them are both real visit-equivalent events, so both now stamp `medicalRecords.lastVisit` to today's date — but the TypeScript type for `updateMedicalRecord()`'s input doesn't list `lastVisit` as a field, so the code currently reaches around it with an `as any` cast rather than a proper typed field.
- **Ask the team / fix (small, low-risk):** Add `lastVisit?: string;` to `MedicalRecordUpdateInput` and remove the `as any` cast in `PatientRecordView.tsx`.

### 18. Edits made via Edit Record / Dispense Medication don't live-refresh the Patients list

- **Where:** Nurse → Patients page.
- **Context:** After editing a chart or dispensing medication on the Patient Record page, going back to the Patients list still shows stale data (e.g. old "Last Visit") until a manual page refresh. Most other Nurse data (appointments, handover log, digitize) already uses Firestore's live `onSnapshot` listeners and updates automatically — this specific path doesn't yet.
- **Confirmed acceptable for now** (per team decision, Aug 2026) — not blocking, but real. Worth tightening later if it becomes a demo/usability issue.

---

## 🤖 AI / OCR — Nurse Digitize

### 19. Gemini Vision is a **prototype**, not a finished decision — two real gaps, not one

- **Where:** `src/lib/gemini-ocr.ts`
- **Why it replaced Tesseract.js:** Tesseract (a printed-text OCR engine) performed very poorly on handwritten clinic files in real testing — as low as 24% confidence, most fields left blank. Gemini's multimodal vision handled the same handwritten sample meaningfully better. `src/lib/ocr.ts` (the old Tesseract-based module) is now dead code — unused anywhere in the app, confirmed by a full-repo search — and can be deleted once the team is comfortable Gemini is staying.
- **Gap 1 — data privacy / free tier:** Gemini's **free tier** terms allow Google to use submitted prompts/images (including patient photos) to improve their products — that protection only applies on the **paid** tier. Real patient health data should not go through the free tier. **Current mitigation:** explicitly tested with fake/synthetic patients only, never real ones, and the code is marked `TODO(compliance)` at the top of the file as a loud reminder.
- **Gap 2 — API key exposure:** the app has no backend (browser talks directly to Firebase), so the Gemini API key has to ship inside the client JS bundle (`VITE_GEMINI_API_KEY`) — same exposure class as the Firebase web key, but unlike `RESEND_API_KEY` there's no server to hide it behind. Anyone with DevTools can read and reuse the key. Marked `TODO(security)` in the code.
- **Ask the team, before any real patient data goes through this:** (a) move the Gemini call behind a real backend (a Firebase Cloud Function would work and also solves the key-exposure problem), and/or (b) move to Gemini's paid tier so free-tier data-use terms no longer apply. Either alone helps; both together closes the gap properly.
- **Cost note, since it came up:** Gemini's free tier itself costs nothing (no card required) — the concern above is about _data handling_, not price. If a paid tier is used instead purely to get the stronger data-use terms, current published rates put Gemini Flash-class models at roughly $0.30–$2.50 per million tokens depending on model — cheap at this app's likely volume, but confirm current pricing before committing, since Google's terms/pricing here have changed more than once in 2026 already.

---

## 🔐 Auth / Login Decisions

### 7. 2FA is still a demo placeholder, not real

- Unchanged — see prior note. Not touched by the Nurse module work.

### 8. No age, gender, or patient "status" field

- Unchanged — see prior note.

### 9. `medicalRecordsHistory` has no date field

- **Partially addressed for new Nurse-written notes:** new Clinical Notes added via the Nurse Patient Record page, and new Digitize entries, now include a `visitDate` field. Older/pre-existing history rows still don't have one — display still falls back to ordering by `historyId`. A backfill or a "no date recorded" fallback label is worth considering for old rows.
- **Ask the team:** as before, plus: should old rows get a best-guess backfilled date, or just display as "date unknown"?

### 10. Medical Aid details have no backing collection

- Unchanged — see prior note.

### 11. `notifications` has no "type" field

- Unchanged — see prior note.

### 14. "Reset 2FA" button is a deliberate dev-only bypass

- Unchanged — see prior note. **Repeating the warning since this doc is being widely re-read right now:** this must be removed or gated before any real deployment.

### 15. Password reset emails use Firebase's default (unbranded) template

- Unchanged — see prior note.

---

## ✅ Confirmed working / good design (no action needed)

- Firestore connection, config, and security rules (`allow read, write: if request.auth != null`) all work correctly.
- Collections are otherwise sensibly modeled and match real clinical/pharmacist workflows.
- Anonymous Auth is currently enabled for local testing only — **must be disabled before production**, since the current security rule allows any authenticated (including anonymous) user to read/write everything, including `medicalRecords` and `patients`. Repeating this loudly since it's the single biggest gap in the whole app right now, and it's easy to forget once individual features start working.
- New composite Firestore index (`patients`: `clinicId` Asc + `userId` Asc) confirmed created and **Enabled** — required for the Nurse clinic-scoping work above.

---

## 🧭 Open decisions summary (quick-scan for a team meeting)

1. Is `inventory` really per-clinic now? (#2 — blocks a clean answer on Pharmacist scoping)
2. Should `patientDispensing.note` become a structured field? (#16)
3. Move Gemini OCR behind a backend and/or to paid tier before any real patient photo goes through it (#19) — **do this before any real deployment, not optional**
4. Disable Anonymous Auth and tighten Firestore security rules before real deployment (repeated from "Confirmed working" — it's not actually "working," it's a known open gap being tracked loosely)
5. Remove/gate the "Reset 2FA" dev bypass before real deployment (#14)

---

_(Keep adding to this as we find more — nothing gets fixed silently, everything goes here first.)_

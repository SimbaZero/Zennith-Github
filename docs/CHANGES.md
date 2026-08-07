# Changes — Reception Queue & Nurse OCR

Record of what changed, why, and what the team needs to know. Covers the work
merged in commits `2022a21` (features) and `7ced91d` (merge with `origin/main`).

---

## Summary

Two features that were previously simulated are now genuinely functional:

| Feature | Before | After |
|---|---|---|
| Reception walk-in queue | `useState(appointments.slice(0, 6))` over mock data — private to one component, reset on refresh, invisible to clinical staff | Shared Firestore `queue` collection with live `onSnapshot` updates, validated walk-in entry, and real patient notifications |
| Nurse file digitisation (OCR) | 1.5-second `setTimeout` revealing hardcoded data for "Lindiwe Mahlangu"; "Save to Database" did nothing | Real on-device OCR (Tesseract.js) with editable fields, confidence flagging, and writes into the patient's actual records |

---

## 1. Reception queue

### What it does now

- **Shared, not local.** The queue lives in a Firestore `queue` collection. Any
  screen calling `subscribeQueue()` receives live updates — when reception adds
  or calls a patient, every subscriber re-renders immediately, no refresh.
- **Validated walk-in entry.** Add by Patient ID (`Pat-3`); the patient must
  exist in `patients`, and their real name is joined from `users`. Unknown IDs
  and duplicate active entries are rejected.
- **Priority and lifecycle.** `urgent` entries sort to the front. Status flows
  `waiting → called → in-room → done`.
- **Real notification on call.** "Call next" flips the entry to `called` and
  writes a document to `notifications`, addressed to the patient's numeric
  `userId`, so it appears in their portal. The existing 07:00–20:00 quiet-hours
  rule is preserved — outside the window the notification is stamped with the
  next allowed delivery time rather than sent immediately.
- The appointments panel on the same page reads live Firestore
  (`fetchRecentAppointments`) instead of `lib/data`.

### New collection: `queue`

```
queue/{autoId}
  patientId    "Pat-3"          -> patients/Pat-3
  patientName  "Themba Tshabalala"   (denormalised at insert for fast rendering)
  reason       "Chest pain"
  clinician    "Doc-2" | null   -> doctors/Doc-2
  priority     "normal" | "urgent"
  status       "waiting" | "called" | "in-room" | "done"
  joinedAt     ISO timestamp
  calledAt     ISO timestamp | null
  facilityId   "hillbrow" | null
```

> **Action required before tightening security rules:** a new collection is
> denied by default under per-role rules. Add:
> ```
> match /queue/{id} {
>   allow read: if request.auth != null;
>   allow write: if role() in ['receptionist', 'nurse', 'doctor', 'admin'];
> }
> ```

### API added to `src/lib/clinic-data.ts`

| Function | Purpose |
|---|---|
| `subscribeQueue(onChange, onError)` | Live subscription; returns an unsubscribe function |
| `fetchQueue()` | One-off read where a subscription isn't warranted |
| `addToQueue({ patientId, reason, clinician?, priority?, facilityId? })` | Validates the patient, joins the name, inserts |
| `callPatient(entry, deliverAt)` | Marks `called` and writes the patient notification |
| `setQueueStatus(id, status)` | Advances the lifecycle |
| `removeFromQueue(id)` | Deletes the entry |

---

## 2. Nurse OCR (file digitisation)

### What it does now

- **Real OCR on-device.** `tesseract.js` reads a photographed or uploaded image
  entirely in the browser. No API key, no per-scan cost, and **no patient data
  leaves the device** — which matters for medical records.
- **Progress and transparency.** Live percentage while scanning, and the raw
  extracted text is viewable for checking a poor scan.
- **Field parsing.** Values are pulled by label (`Full Name:`, `Diagnosis:` …)
  with fallbacks that pattern-match a 13-digit SA ID, phone numbers, and dates
  when labels are missing or misread.
- **Human verification is mandatory by design.** Every field is editable, and
  scans below 85% confidence are visibly flagged for review.
- **Saving writes real records:**
  - appends a note to `medicalRecordsHistory` including the raw scan text
    (`source: "ocr"`) for audit,
  - merges captured clinical fields into `medicalRecords`,
  - refreshes demographics (`idNumber`, `contactNum`, `dateOfBirth`) on `users`.
  - Blank fields are never written over existing data.

### Files

- `src/lib/ocr.ts` — `recogniseImage()`, `parsePatientFile()`, `REVIEW_THRESHOLD`
- `saveDigitisedRecord()` in `src/lib/clinic-data.ts`
- `src/routes/nurse.digitize.tsx` — rewritten UI

### Accuracy expectation

This is real OCR, so results are good on printed/typed text and **poor on
handwriting**. The confidence flag and editable fields exist for that reason.
Upgrading to Google Cloud Vision (much better on handwriting) would require a
billing account, an API key, and a server-side proxy.

---

## 3. New dependency

`tesseract.js` — added to `package.json`.

> **Important pattern:** it is **dynamically imported inside a handler**, not at
> module top level:
> ```ts
> const { default: Tesseract } = await import("tesseract.js");
> ```
> It is browser-only (web workers + WASM). A top-level import pulls it into the
> Cloudflare Workers SSR bundle and breaks the route on the server — the same
> issue previously hit with the `qrcode` library on the 2FA page. **Any
> browser-only library must be imported this way.**

---

## 4. Encoding repair (bug fix)

Ten route files had UTF-8 mojibake committed: `·` rendered as `Â·`, `—` as
`â€"`, `…` as `â€¦`, plus a stray BOM. Cause: a PowerShell copy step read UTF-8
files as ANSI and rewrote them.

All occurrences are fixed. **If you edit files with PowerShell scripts**, use
byte-safe IO — `Get-Content -Raw` in Windows PowerShell 5.1 misreads UTF-8:

```powershell
$t = [System.IO.File]::ReadAllText($p, [System.Text.Encoding]::UTF8)
[System.IO.File]::WriteAllText($p, $t, (New-Object System.Text.UTF8Encoding($false)))
```

---

## 5. Merge notes (`7ced91d`)

Six commits landed on `origin/main` in parallel (doctor backend, reception
backend connection, patient services, password reset, 2FA fallback patch).
The merge conflicted in six files, resolved deliberately:

| File | Resolution |
|---|---|
| `PatientRecordView.tsx`, `doctor.appointments.tsx`, `doctor.index.tsx`, `doctor.schedule.tsx`, `receptionist.registration.tsx` | **Took `origin/main`** — the incoming work is newer; the only local change was the encoding fix, which was re-applied on top |
| `receptionist.index.tsx` | **Kept the local version** — it is a superset: it contains the same live-Firestore appointments panel *plus* the new shared queue |

No incoming work was overwritten. Nothing was force-pushed.

---

## 6. Verification performed

Queue backend tested against the live database, with test documents deleted
afterwards:

- patient validation (`Pat-3` accepted, unknown ID rejected) ✓
- name join `patients → users` resolved ✓
- writes to the new `queue` collection accepted by current rules ✓
- duplicate-guard query ✓
- status flip to `called` ✓
- notification written and addressed to the correct `userId` ✓

`npx tsc --noEmit` passes clean on the merged tree.

**Not yet verified in-browser:** the queue and OCR UIs were not clicked through,
because the `receptionist` and `nurse` accounts now have 2FA enrolled and the
authenticator codes aren't available here. Worth a manual pass.

---

## 7. Follow-ups

- [ ] Add the `queue` security rule before tightening to per-role rules
- [ ] Manual browser test of both features (needs an authenticator)
- [ ] Optional: render the same live queue on the nurse/doctor dashboards —
      the data layer already supports it (`subscribeQueue`), only a widget is missing
- [ ] Consider a `patientName` refresh strategy — the name is denormalised into
      the queue entry at insert time
- [ ] OCR: evaluate Google Cloud Vision if handwriting recognition is required

---

## Related documents

- [ADDING-DATA.md](ADDING-DATA.md) — how to create new collections and linked records
- [FIREBASE.md](FIREBASE.md) — console setup, security rules, operations
- [ARCHITECTURE.md](ARCHITECTURE.md) — auth flow and data model

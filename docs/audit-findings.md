# Zennith — Application Audit Findings

Read-only audit of every route in `src/routes/`, every module in `src/lib/`, and the
shared components. Nothing in this pass was changed; this document is the only file
added.

**Date:** 7 October 2026
**Scope:** 48 routes, 40 lib modules, 11 shared components (~30k lines)
**Method:** traced each page's data source (collection, live `onSnapshot` vs one-shot
`getDocs`, cache layer) and read the write paths behind every form.

## How to read this

Findings are organised by role, then by page, as requested. Many problems are the
*same* problem appearing on eight pages — repeating them per page would bury the
specifics, so those are written once in **[Cross-cutting findings](#cross-cutting-findings)**
with an ID (`C1`…`C13`), and the per-role sections reference the ID and add only
what is specific to that page.

Each finding carries:

- **Severity** — high (wrong clinical/operational data, silent data loss, privacy),
  medium (wrong or stale display, confusing workflow), low (polish, naming, dead code)
- **Fix size** — small (under an hour), medium (half a day), large (needs a schema or
  team decision first)

Where I could not tell whether something is a bug or a deliberate decision, it says
so explicitly rather than guessing. `docs/db-issues.md` already tracks a number of
these; where it does, the entry is cross-referenced (`db-issues #N`) so nothing gets
counted twice or re-litigated.

### Severity tally

| | High | Medium | Low |
|---|---|---|---|
| Cross-cutting | 6 | 5 | 2 |
| Patient | 2 | 4 | 2 |
| Nurse | 1 | 3 | 3 |
| Doctor | 0 | 3 | 2 |
| Pharmacist | 2 | 4 | 2 |
| Receptionist | 2 | 4 | 3 |
| Admin | 0 | 3 | 2 |
| Super Admin | 0 | 1 | 2 |

---

## Cross-cutting findings

### C1 — Appointment times are displayed two hours late to patients, and correctly to staff

**Severity: high · Fix: small (display) / medium (if the storage convention changes)**
**Files:** `src/lib/clinic-time.ts:1-8`, `src/lib/clinic-data.ts:1257`,
`src/routes/patient.appointments.tsx:37-44`, `src/routes/patient.index.tsx:28-36`,
`src/lib/doctor-service.ts:291-295`, `src/lib/clinic-data.ts:1139-1143`

`createAppointment` stores the clinic's **wall-clock** time with a `Z` suffix:

```
appointDateTime: `${input.date}T${input.time}:00.000Z`    // clinic-data.ts:1257
```

So a 10:00 SAST appointment is stored as `2026-10-07T10:00:00.000Z`. `clinic-time.ts`
documents this convention explicitly and warns that comparing it against the real UTC
clock "puts everything two hours late."

Two roles then read it two different ways:

| Page | Code | Shows a 10:00 appointment as |
|---|---|---|
| Doctor appointments | `dt.toISOString().slice(11,16)` | **10:00** ✅ |
| Nurse appointments | same hook (`useDoctorAppointments`) | **10:00** ✅ |
| Patient appointments | `dt.toLocaleTimeString("en-ZA", …)` | **12:00** ❌ |
| Patient dashboard | `new Date(iso).toLocaleString("en-ZA", …)` | **12:00** ❌ |

`toLocaleTimeString` converts the "+0" instant into SAST and adds two hours. The
patient and the doctor are looking at the same appointment document and reading
different times off it.

**Why it matters:** this is the single worst finding in the audit. A patient told
12:00 arrives two hours after the clinic expected them, and reception/doctor have no
way of knowing the patient was shown a different number. It also affects
"past vs upcoming" bucketing: `patient.appointments.tsx:53` compares
`new Date(a.dateTime) < now`, so an appointment stays listed as upcoming for two
hours after it has actually passed.

**Fix:** format from the string, not through the local timezone — `slice(11,16)` for
the time and `slice(0,10)` for the date, matching the doctor/nurse path. Alternatively
store a real UTC instant and convert on display everywhere, which is cleaner but
touches every reader and needs a data migration (large).

---

### C2 — Three different definitions of "today" coexist

**Severity: high · Fix: medium**
**Files:** ~20 sites; see below

| Frame | How it's computed | Where |
|---|---|---|
| Real UTC | `new Date().toISOString().slice(0,10)` | `doctor.index.tsx:14`, `nurse.index.tsx:35`, `pharmacist.index.tsx:31,34`, `doctor.appointments.tsx:29`, `nurse.appointments.tsx:28`, `receptionist.queue.tsx:240`, `receptionist.appointments.tsx:67`, `clinic-data.ts:1152,1854,2370`, `doctor-service.ts:363`, `patient-service.ts:548,742`, `pharmacist-service.ts:241,406,1084,1105,1482`, `PatientRecordView.tsx:131,181` |
| Device local | `localDateKey()` | `receptionist.index.tsx:47-56` |
| Clinic timezone | `clinicWallClock()` | `clinic-time.ts:11`, used only by `appointment-reminders.ts:93` and `smsportal.ts` |

South Africa is UTC+2, so the UTC form is **yesterday's date until 02:00 local**.
Everything keyed on it is wrong for those two hours: "appointments today", "doses due
today", "dispensed today", "patients seen today", and the `lastVisit` stamp written by
`PatientRecordView.tsx:131`.

Note that the *correct* fix differs by field, which is why this needs doing
deliberately rather than with a find-and-replace:

- Fields holding a **real instant** (`joinedAt`, `calledAt`, `createdAt`,
  `patientDispensing.createdAt`) → convert to the clinic's day via `clinicWallClock`.
- Fields holding **clinic wall-clock labelled Z** (`appointDateTime`, see C1) → take
  the date straight off the string.

**Why it matters:** a night-shift nurse opening the dashboard at 00:30 sees the wrong
day's work. It is also the kind of bug that looks like flakiness rather than a defect,
so it gets rediscovered repeatedly.

**Uncertain:** `pharmacist.index.tsx:28-30`'s comment ("same UTC day keys as
`useMedicationUsage`") reads like a known, accepted simplification rather than an
oversight. Worth confirming with whoever wrote it before changing the forecasting
maths, since the forecast's day-bucketing must stay consistent with its history.

---

### C3 — Module-level caches are never cleared, so edited names stay stale and survive sign-out

**Severity: high · Fix: small**
**Files:** `src/lib/doctor-service.ts:146,235,515`, `src/lib/nurse-service.ts:85,218`,
`src/lib/patient-service.ts:103,303`, `src/lib/pharmacist-service.ts:455`,
`src/components/AppShell.tsx:250-253`, `src/lib/auth.ts:669-684`

Seven module-level `Map` caches hold resolved identities for the lifetime of the
JavaScript bundle:

| Cache | File:line | Keyed by | Cleared? |
|---|---|---|---|
| `patientDetailCache` (name) | `doctor-service.ts:515` | patientId | never |
| `patientNameCache` | `doctor-service.ts:235` | patientId | never |
| `doctorCacheByUid` | `doctor-service.ts:62` | uid | `clearDoctorCache()` — **never called** |
| `nurseCacheByUid` | `nurse-service.ts:85` | uid | `clearNurseCache()` — **never called** |
| `pharmacistCacheByUid` | `pharmacist-service.ts:455` | uid | never |
| `patientIdCacheByUid` | `patient-service.ts:103` | uid | never |
| `clinicianNameCache` | `patient-service.ts:303` | clinicianId | never |

Two distinct defects fall out of this.

**(a) A renamed patient keeps their old name on clinical pages.** `enrichPatient`
(`doctor-service.ts:520-546`) deliberately skips the `users` read when the name is
already cached:

```ts
const cachedName = patientDetailCache.get(patientId)?.name;
// …
cachedName == null && p.userId != null ? getDoc(doc(db, "users", …)) : null
```

The comment above it says *"A name comes from the users doc and effectively never
changes"* — but `receptionist.profiles_.$pid.tsx:160` edits exactly that, via
`updateUser(userId, { names, surname })`. So after reception corrects a misspelled
name:

- Reception's own list updates immediately (TanStack Query invalidation, line 212-214) ✅
- **Doctor → Patient Files** keeps the old name until a full browser reload ❌
- **Nurse → Patients** same (`usePatientFiles` → `enrichPatient`, line 796) ❌
- **Doctor/Nurse → Appointments** same (`resolvePatientNames`, line 304) ❌
- **Pharmacist → Fast Lane Handover** same, for a different reason (C8) ❌

The `patients` listener *does* fire and the row *does* re-render — it just re-renders
with the cached name, which makes it look like the live subscription is broken when it
isn't. Note the same comment records that `lastVisit` was removed from this cache for
precisely this reason; `name` is the remaining half of that bug.

**(b) Caches outlive the user.** `handleSignOut` (`AppShell.tsx:250`) calls
`clearAuth()`, which removes three `localStorage` keys and calls `fbSignOut`. It does
not call `clearDoctorCache()` or `clearNurseCache()` — which exist for this purpose and
have **no callers anywhere in the codebase** — and nothing clears the other five. In a
single-page app with no hard reload between sessions, the next user on that browser
inherits the previous user's cached rows. The uid-keyed caches are safe (a new uid
misses), but `patientNameCache`, `patientDetailCache` and `clinicianNameCache` are
keyed by patient/clinician id, so a name resolved during user A's session is served to
user B without a Firestore read — bypassing the clinic scoping that the queries
themselves enforce.

**Fix:** export a `clearAllCaches()` that each service contributes to, call it from
`clearAuth()`, and drop `name` from `patientDetailCache` (keep the row, re-read the
users doc). Both small.

---

### C4 — A field can be edited but never cleared: `|| undefined` + `stripUndefined`

**Severity: high · Fix: small**
**Files:** `src/lib/clinic-data.ts:1944-1950`,
`src/components/PatientRecordView.tsx:126-150`,
`src/routes/receptionist.profiles_.$pid.tsx:156-190`

`stripUndefined` removes undefined keys before every `updateDoc` (correct — Firestore
rejects undefined). But the callers convert "user cleared this field" into `undefined`:

```ts
// PatientRecordView.tsx:141
allergies: form.allergies || undefined,
// receptionist.profiles_.$pid.tsx:156
const insurance = form.insurance !== "None" ? form.insurance.trim() : undefined;
```

An emptied field therefore becomes `undefined` → is stripped → **is not written**. The
old value stays in Firestore. The UI shows the cleared field, the toast says
"Medical record updated" / "Patient profile updated", and on the next load the old
value reappears.

This is the "disappears on refresh and comes back" class of bug, and it has a
patient-safety edge: **a wrongly recorded allergy cannot be removed.** A nurse who
clears "Penicillin" from a patient who does not have that allergy is told the record
was updated, and "Penicillin" is still there for the next clinician. The same applies
to `prescription`, `bloodType`, `bp`, `condition`, `cd4`, `viralLoad`, `glucose`,
`dosage` and reception's `insurance`.

**Fix:** write `""` (or `deleteField()`) for an intentionally emptied field, and keep
`undefined` to mean "this form didn't touch this field". Small, but every caller needs
checking — the two meanings are currently conflated everywhere.

---

### C5 — Pharmacist stock falls back to fabricated demo data, silently

**Severity: high · Fix: small**
**Files:** `src/lib/pharmacist-service.ts:110-128`, `src/lib/data.ts` (`mockStock`),
`src/routes/patient.index.tsx:7`, `pharmacist.deliveries.tsx`, `pharmacist.diagnostics.tsx`

`useInventory()`'s error path replaces the real inventory with `mockStock`:

```ts
(err) => {
  console.warn("Falling back to mock stock data:", err.message);
  setStock(mockStock);
  setUsingFallback(true);
  setLoading(false);
}
```

It returns `usingFallback` so a caller can warn the user. **No caller reads it** —
confirmed by grep across `src/routes` and `src/components`: zero hits for
`usingFallback` or `mockStock` outside the service and `data.ts`.

So on a permission error, an expired session, or an offline first load, the pharmacist's
Deliveries and Fast Lane pages — **and the patient's "Find a medication" search** —
display invented stock numbers indistinguishable from real ones.

**Why it matters:** a patient is told a medication is "In stock" based on demo data and
travels to the clinic for it. `useMedicationStatus` was deliberately rewritten
(`patient-service.ts:960-970`) to stop making exactly that false promise — the comment
there explains the cost of a wasted trip for someone without transport money. This path
reintroduces it.

**Fix:** surface `usingFallback` as a visible banner, or drop the mock fallback and show
an error state. Small either way. The second is better: a clinical app showing fake
stock is worse than one showing an error.

---

### C6 — Medication names are free text matched exactly, so typos split the stock count

**Severity: high · Fix: large (needs a medication reference collection)**
**Files:** `src/lib/pharmacist-service.ts:935-952`, `src/routes/nurse.stock.tsx:479-530`,
`src/lib/nurse-service.ts:861-910`, `src/lib/pharmacist-service.ts:1366-1380,1053-1110`

`inventory.medName` is a plain string, and every lookup is an exact equality match:

```ts
// recordExternalStock, pharmacist-service.ts:935
where("clinicId", "==", input.clinicId),
where("medName", "==", input.medName),
```

`"Metformin"`, `"metformin"`, `"Metformin "` and `"Metformin 500mg"` are four different
medications to this query. `existing.empty` is then true, and `addDoc` creates a second
inventory row for the same drug.

Consequences, all traced:

- **Stock splits in two.** 200 units become "120 Metformin" + "80 metformin", and both
  rows sit below their reorder threshold, so the dashboard raises two false reorder
  alerts (`pharmacist.index.tsx:46-52`).
- **Forecasting silently halves.** `useMedicationUsage` and `useClinicForecasts` key
  history by name, so usage attributed to one spelling doesn't count toward the other's
  days-remaining.
- **Cross-clinic lookup misses.** `findMedicationAtOtherClinics` matches by name, so a
  clinic holding the drug under a different spelling looks like it has none.
- **The patient's search lies.** `patient.index.tsx` renders `key={s.name}` over
  unaggregated rows — duplicate React keys, and the same drug can appear twice with
  contradictory "In stock"/"Out of stock" badges.
- **Trends collide.** `useMedicationDispenseTrends` returns `Record<string, number[]>`
  keyed by name.

The code knows. `nurse.stock.tsx:516-519` adds a `<datalist>` of known names and
comments: *"a typo creates a duplicate inventory row instead of adding to the existing
one."* A datalist suggests but does not constrain — free typing is still accepted, which
is correct for genuinely new stock but leaves the failure mode open.

**What structuring involves:** a `medications` collection (code, generic name, strength,
form, unit) with `inventory.medicationId` replacing `medName` as the join key; name kept
as a denormalised display field. Entry points become a picker over that collection with
an explicit "add a new medication" path that an admin or pharmacist confirms. The South
African EML / NAPPI codes would be the natural source for the seed list. Needs a
migration for existing rows and a de-duplication pass. Large, and the highest-value
structural change in this document.

**Interaction with `db-issues #2`:** whether `inventory` is per-clinic is still an open
team question. This finding stands either way — the match is on `medName` in both models.

---

### C7 — Real data is kept in `localStorage`, unscoped and never cleared

**Severity: high (medical aid) / medium (the rest) · Fix: small to medium**

| Key | Written at | Problem |
|---|---|---|
| `zennith_medical_aid` | `patient.medical-record.tsx:30,55-58` | Provider, scheme and **member number** for the signed-in patient, with **no patient id in the key** and no clearing on sign-out. On any shared device — a clinic tablet, a family phone — patient B opens their medical record and sees patient A's medical aid details. No staff member can see them at all. |
| `zennith_dismissed_flags` | `admin.audit.tsx:100,110` | The comment says *"dismissed per-admin"* — the key is global. Admin B inherits admin A's dismissed audit flags on the same browser. |
| `zennith_active_clinic_{role}` | `active-clinic.ts:30,36` | Survives sign-out; the module store `activeIdByRole` isn't reset either. The next doctor on that browser briefly sees the previous doctor's clinic. |
| `zennith_current_patient_id` | `login.tsx:67` | **Written and never read** — grep finds no reader. A patient id left in `localStorage` for no functional reason. |

The medical-aid case is logged as a known gap (`db-issues #10` — no backing collection
exists). The *shared-key* and *never-cleared* parts are separate defects that are
fixable today without the schema decision: namespace the key by `patientId` and remove
it in `clearAuth()`. Likewise for the other three keys.

**Uncertain:** keeping "I have reviewed this flag" out of Firestore is a defensible
design call and the rationale is written down. Only the missing per-admin scoping is
clearly a bug.

---

### C8 — Five implementations of "list patients", with different scoping, liveness and names

**Severity: medium · Fix: medium**

| Implementation | File | Live? | Clinic-scoped? | Used by |
|---|---|---|---|---|
| `usePatientFiles` | `doctor-service.ts:750` | yes | yes | doctor.patients, nurse.patients |
| `useFindPatientById` | `doctor-service.ts:614` | yes | yes | doctor.patients, nurse.patients |
| `usePatientDirectory` | `doctor-service.ts:555` | yes | yes | **nothing — dead code** |
| `usePatientDirectory` | `pharmacist-service.ts:311` | **no** (one-shot `getDocs`) | **no** | pharmacist.diagnostics |
| `useReceptionPatientDirectory` | `clinic-data.ts:887` | — | yes | receptionist.queue |
| `findPatient` | `clinic-data.ts:921` | — | **no** (`db-issues #24`) | receptionist.profiles |

Two different hooks are both called `usePatientDirectory` and behave differently; the
one in `doctor-service.ts` is the better implementation and is unused. The
pharmacist one is the weakest: a single `getDocs(collection(db,"patients"))` plus
`getDocs(collection(db,"users"))` with `[]` deps — **every patient and every user in the
entire platform**, read once, never refreshed, and errors only `console.error`ed
(`pharmacist-service.ts:352`).

**Why it matters:** cross-clinic patient exposure on the pharmacist page, an
ever-growing read cost as the platform adds clinics, and a list that silently stops
reflecting reality for as long as the page stays open.

**Fix:** delete the dead hook, rename the pharmacist one, and point it at
`usePatientFiles`. Medium, mostly because the pharmacist page's search expectations
differ.

---

### C9 — The same `Stat` card is reimplemented seven times

**Severity: low · Fix: small**
**Files:** `doctor.index.tsx:144`, `nurse.index.tsx:383`, `admin.index.tsx:134`,
`pharmacist.analytics.tsx:338`, `super-admin.index.tsx:68`, `receptionist.index.tsx:368`,
`pharmacist.index.tsx:177`

Seven local `function Stat({...})` definitions, with drifting props (`receptionist`'s
takes `alert?: boolean`, `pharmacist`'s takes `tone`, `admin`'s takes neither) and
drifting markup. Any change to dashboard tile styling has to be made seven times, and
the tiles already differ subtly between roles.

**Fix:** one `<StatCard>` in `src/components/`, with `tone` covering both existing
variants.

---

### C10 — Text below 12px throughout, on pages used on tablets

**Severity: medium · Fix: small per page**

`text-[9px]`, `text-[10px]` and `text-[11px]` appear ~90 times across 30 routes, densest
in `pharmacist.deliveries.tsx` (13), `nurse.stock.tsx` (11), `receptionist.queue.tsx` (9),
`admin.staff.tsx` (7) and `receptionist.registration.tsx` (6). Stat-card labels are
`text-[11px]` on all seven dashboards.

Paired with this: action buttons at `py-1`/`py-1.5` (≈28–30px tall) in
`receptionist.appointments.tsx`, `nurse.appointments.tsx`, `doctor.appointments.tsx`,
`pharmacist.deliveries.tsx` and `admin.staff.tsx` — below the ~44px comfortable touch
target, on pages staff work from a tablet.

`receptionist.queue.tsx`'s per-patient row was already brought up to a 12px floor and
40px targets; nothing else has been.

**Fix:** a 12px minimum and a shared button size scale. Small per page, but it is 30
pages.

---

### C11 — `medicalRecordsHistory` has four writers, four shapes, and no author

**Severity: medium · Fix: medium**
**Files:** `PatientRecordView.tsx:176`, `clinic-data.ts:1071`, `clinic-data.ts:1586`,
`nurse-service.ts:756`, `patient-service.ts:788`

| Writer | Fields written | Date field |
|---|---|---|
| Clinical note (`PatientRecordView.tsx:176`) | historyId, medicalRecordNo, patientId, description | `visitDate` |
| Digitize (`nurse-service.ts:756`) | same + `"Digitized file: …"` prefix | `visitDate` |
| `saveDigitisedRecord` (`clinic-data.ts:1071`) | + `source:"ocr"`, `rawText` | `capturedAt` |
| Registration note (`clinic-data.ts:1586`) | historyId, medicalRecordNo, patientId, description | **none** |

Three problems:

1. **No author on any of them.** A clinical note in a patient's record cannot be
   attributed to the clinician who wrote it. For a medical record this is a
   significant omission — see "Missing fields" below.
2. **The date field is inconsistent** (`visitDate` / `capturedAt` / absent), so
   `usePatientVisitHistory` (`patient-service.ts:788-805`) ignores dates entirely and
   sorts by `historyId` (a `Date.now()` written by the client). The patient's visit
   history is therefore an **undated list**, ordered by write time rather than visit
   time, and two notes written in the same millisecond collide on `historyId`.
3. `clinic-data.ts:1056`'s `saveDigitisedRecord` is **dead code** — `nurse.digitize.tsx`
   calls `nurse-service.ts`'s `saveDigitizedFile` instead. Two implementations of the
   same flow, spelled differently ("Digitised" vs "Digitized"), with divergent schemas.

**Fix:** one writer function, with `authorId`, `authorRole` and a single server-stamped
date. Medium; existing rows keep working if the reader falls back.

---

### C12 — Patient-facing listeners log errors but show nothing

**Severity: medium · Fix: medium**
**File:** `src/lib/patient-service.ts` (lines 176, 197, 212, 227, 353, 459, 604, 791, 852, 992)

All ten `onSnapshot` calls now pass an error callback — `db-issues #25` is half
resolved. But every one of them only `console.error`s, and **none of the hooks expose an
error to the UI**: `useCurrentPatient` returns `{patient, loading}`,
`usePatientAppointments`/`usePatientNotifications`/`usePatientVisitHistory` return bare
arrays.

So a permission failure or a dropped subscription still presents to the patient as an
empty page or a page frozen on stale data — now with a console line nobody will see. No
patient route renders an error state (`patient.index.tsx`, `patient.medical-record.tsx`:
zero error handling).

**Fix:** return `error` from each hook and render it. Medium — ten hooks and five pages.

---

### C13 — Dead code that looks live

**Severity: low · Fix: small**

- `clearDoctorCache()` (`doctor-service.ts:146`) and `clearNurseCache()`
  (`nurse-service.ts:218`) — no callers (see C3).
- `usePatientDirectory` (`doctor-service.ts:555`) — no callers (see C8).
- `saveDigitisedRecord` (`clinic-data.ts:1056`, ~75 lines) — no callers (see C11).
- `usingFallback` (`pharmacist-service.ts:128`) — returned, never read (see C5).
- `zennith_current_patient_id` (`login.tsx:67`) — written, never read (see C7).

Each one reads as an implemented safeguard. Someone reviewing sign-out would
reasonably conclude the caches are cleared.

---

## Patient

### `patient.index.tsx` — "My Dashboard"

| # | Finding | Severity | Fix |
|---|---|---|---|
| PAT-1 | Appointment times two hours late — **C1** | high | small |
| PAT-2 | "Find a medication" reads unscoped, mock-fallback stock — **C5**, **C6** | high | small |
| PAT-3 | No loading state on the medication search | medium | small |
| PAT-4 | No error state anywhere on the page — **C12** | medium | medium |
| PAT-5 | `useNow(1000)` re-renders the whole dashboard every second | low | small |

**PAT-2 detail.** The page destructures `const { stock } = useInventory()` — dropping
both `loading` and `usingFallback`. "Search current stock across the pharmacy" searches
*every clinic's* stock, so a patient at Hillbrow is told a drug is in stock when it is at
Orchards. The copy says "the pharmacy", singular, which is the single-central-pharmacy
model that `db-issues #2` says is no longer what the data looks like.

**PAT-3 detail.** Because `loading` is dropped, before the first snapshot lands
`results` is empty and the page renders "No match found." — a confident wrong answer
where a spinner belongs.

**PAT-5 detail.** `useNow(1000)` drives a seconds-precision clock in the header. Every
tick re-renders the dashboard including the search list. A minute ticker, or isolating
the clock into its own component, fixes it.

### `patient.medical-record.tsx` — "My Medical Record"

| # | Finding | Severity | Fix |
|---|---|---|---|
| PAT-6 | Medical aid in a shared `localStorage` key — **C7** | high | small |
| PAT-7 | Visit history is undated and client-ordered — **C11** | medium | medium |
| PAT-8 | Clinical fields are read-only free text — see the field register | medium | large |
| PAT-9 | No error state; `loading` only covers the identity block | low | small |

**PAT-6 detail.** The page writes `{provider, scheme, memberNo, privatePay}` to
`zennith_medical_aid`. Three consequences: it is invisible to every staff member
(reception captures medical aid separately — see REC-3), it is lost on cache clear, and
it is served to whoever opens the page next on that device. The *absence of a
collection* is known (`db-issues #10`); the shared key is not.

**PAT-8 detail.** "Allergies" is one string. "Blood Type" is a free string rather than
one of eight values. "Blood Pressure" is a string like `120/80`. See the
[free-text register](#appendix-a--free-text-field-register).

### `patient.appointments.tsx` — "My Appointments"

| # | Finding | Severity | Fix |
|---|---|---|---|
| PAT-10 | Times two hours late — **C1** | high | small |
| PAT-11 | Past/upcoming split is two hours late — **C1** | medium | small |
| PAT-12 | Clinician names come from a never-cleared cache — **C3** | medium | small |

### `patient.alerts.tsx` — "Notifications & Alerts"

| # | Finding | Severity | Fix |
|---|---|---|---|
| PAT-13 | Whole notification row is a `<button>` that marks read on any click | low | small |
| PAT-14 | Four names for one concept — see the [terminology register](#appendix-b--terminology-register) | low | small |

**PAT-13 detail.** `patient.alerts.tsx:72-74` wraps the entire row in a button whose
`onClick` marks it read. A patient tapping to read the text marks it read as a side
effect, and there is no way to mark it unread again. Whether that is intended is
unclear — it may well be deliberate. Flagging it as a question, not a defect.

### `patient.privacy.tsx` — "Privacy & Data Settings"

No findings beyond C12. The privacy settings and deletion-request flow were moved off
`localStorage` into Firestore and the reasoning is documented at
`patient-service.ts:813-823`; reception's edit page correctly honours the flags
(`receptionist.profiles_.$pid.tsx:166-184`). This is the best-implemented data flow in
the app and worth using as the reference pattern.

---

## Nurse

### `nurse.patients.tsx` — "Patients"

| # | Finding | Severity | Fix |
|---|---|---|---|
| NUR-1 | Renamed patients keep their old name — **C3a** | high | small |
| NUR-2 | Edits don't live-refresh the list — `db-issues #22`, accepted Aug 2026 | medium | medium |

### `nurse.stock.tsx` — "Stock"

| # | Finding | Severity | Fix |
|---|---|---|---|
| NUR-3 | Free-text medication name creates duplicate rows — **C6** | high | large |
| NUR-4 | No loading state (zero `loading` references in the file) | medium | small |
| NUR-5 | `category: "External"` is written for all nurse-added stock | low | small |
| NUR-6 | 11 sub-12px text sites, submit button at `py-2` with `text-xs` — **C10** | medium | small |

**NUR-5 detail.** `recordExternalStock` (`pharmacist-service.ts:943`) hardcodes
`category: "External"`. "External" describes *how it arrived*, not *what it is*, so
category stops being usable as a therapeutic grouping once any outside stock exists.
A `source` field already carries the supplier — the category should be the real one.

### `nurse.appointments.tsx` — "Schedule Appointments"

| # | Finding | Severity | Fix |
|---|---|---|---|
| NUR-7 | Nurse schedule is built from `useDoctorAppointments(nurse.nurseId)` | low | small |
| NUR-8 | "today" is UTC — **C2** | medium | small |
| NUR-9 | Day-cell buttons at `py-1`/`py-1.5` — **C10** | medium | small |

**NUR-7 detail.** `nurse.appointments.tsx:9` imports the doctor hook with the comment
*"role-agnostic despite the name"*. It works — the query is
`where("clinician","==",id)` and a nurse id is a valid clinician value — but the naming
means a reader has to verify that before trusting it. Rename to
`useClinicianAppointments`. Acknowledged debt, not a bug.

### `nurse.digitize.tsx` — "Digitize Patient Files"

| # | Finding | Severity | Fix |
|---|---|---|---|
| NUR-10 | OCR output lands in free-text clinical fields unvalidated | medium | large |
| NUR-11 | No loading or empty state (zero references to either) | medium | small |
| NUR-12 | Duplicate, divergent save path exists — **C11.3** | low | small |

**NUR-10 detail.** `saveDigitizedFile` (`nurse-service.ts:740-752`) writes
`currentMedication → prescription`, `allergies`, `bloodType`, `bloodPressure → bp`
straight from Gemini's extraction into the patient's clinical record, with only
truthiness checks. A misread medication name becomes that patient's prescription of
record, and (per C6) a new inventory row if anyone later stocks it under that spelling.
The OCR prototype's privacy and key-exposure gaps are already tracked
(`db-issues #23`); the *unvalidated write* is a separate concern and worth a review
step before commit.

### `nurse.index.tsx` — "Nurse Dashboard"

| # | Finding | Severity | Fix |
|---|---|---|---|
| NUR-13 | "today" is UTC — **C2** | medium | small |
| NUR-14 | Duplicate `Stat` — **C9** | low | small |

---

## Doctor

### `doctor.patients.tsx` — "Patient Files"

| # | Finding | Severity | Fix |
|---|---|---|---|
| DOC-1 | Renamed patients keep their old name — **C3a** | medium | small |
| DOC-2 | Clinic switcher state survives sign-out — **C7** | medium | small |

This page is otherwise the strongest list implementation in the app: clinic-scoped,
paged, server-side search, real loading/error/empty states (`usePatientFiles`
returns `loading`, `loadingMore`, `error`, `hasMore`, `isSearching` and the page renders
all of them). Worth copying for the pharmacist directory (C8).

### `doctor.appointments.tsx` — "Appointments"

| # | Finding | Severity | Fix |
|---|---|---|---|
| DOC-3 | Patient names from a never-cleared cache — **C3** | medium | small |
| DOC-4 | "today" is UTC — **C2** | medium | small |
| DOC-5 | Buttons at `py-1`/`py-1.5` — **C10** | medium | small |

Times are rendered correctly here (`slice(11,16)`) — this is the side of C1 that is
right.

### `doctor.index.tsx` — "Doctor Dashboard"

| # | Finding | Severity | Fix |
|---|---|---|---|
| DOC-6 | "today" is UTC — **C2** | medium | small |
| DOC-7 | Duplicate `Stat` — **C9** | low | small |

### `doctor.patient-record.$pid.tsx` / `nurse.patient-record.$pid.tsx`

Thin wrappers (17 and 22 lines) around `PatientRecordView`. All findings are in the
shared component — see [Shared components](#shared-components).

---

## Pharmacist

### `pharmacist.diagnostics.tsx` — "Fast Lane Handover"

| # | Finding | Severity | Fix |
|---|---|---|---|
| PHA-1 | Reads every patient on the platform, once, unscoped — **C8** | high | medium |
| PHA-2 | Unscoped inventory with mock fallback — **C5** | high | small |
| PHA-3 | Route file is named `diagnostics`, page is a handover tool | low | small |

**PHA-1 detail.** `usePatientDirectory()` from `pharmacist-service.ts` — two full
collection reads (`patients`, `users`) with no clinic filter and `[]` deps. A pharmacist
can search and hand medication to a patient from any clinic in the platform, and the
list never updates while the page is open. The error path only logs.

**PHA-3 detail.** Nothing in the file relates to diagnostics; the nav label and title
both say "Fast Lane Handover". A reader looking for the handover code will not find it
by filename. Renaming the route changes the URL, so it needs a redirect — small but not
free.

### `pharmacist.stock.tsx` — "Stock Management"

| # | Finding | Severity | Fix |
|---|---|---|---|
| PHA-4 | No loading state (zero references) | medium | small |
| PHA-5 | Nav says "Stock Levels", page says "Stock Management" | low | small |

Correctly uses the clinic-scoped `useClinicForecasts`.

### `pharmacist.deliveries.tsx` — "Stock Deliveries"

| # | Finding | Severity | Fix |
|---|---|---|---|
| PHA-6 | Uses unscoped `useInventory()` while Stock uses scoped data — **C5** | high | small |
| PHA-7 | 13 sub-12px sites, the most in any route — **C10** | medium | small |

**PHA-6 detail.** This is the sharpest within-role inconsistency in the app. Two pages
in the same sidebar disagree about what "stock" means:

| Page | Hook | Shows |
|---|---|---|
| Stock Management | `useClinicForecasts(activeClinicId)` | this clinic |
| Medication Overview | `useClinicForecasts(activeClinicId)` | this clinic |
| Stock Deliveries | `useInventory()` | **every clinic** |
| Fast Lane Handover | `useInventory()` | **every clinic** |

A pharmacist reconciling a delivery against the stock page is comparing two different
populations. `nurse-service.ts:796-798` already flags `useInventory()` as the odd one
out. Changing it to `useClinicForecasts`'s scoping is small; what is *not* small is
confirming the intended model (`db-issues #2`, open).

### `pharmacist.analytics.tsx` — "Medication Overview"

| # | Finding | Severity | Fix |
|---|---|---|---|
| PHA-8 | Forecasts key on free-text `medName` — **C6** | high* | large |
| PHA-9 | Duplicate `Stat` — **C9** | low | small |

\*Severity is high in effect but the root cause is C6; fixing C6 fixes this.

The forecasting maths itself is sound and honestly scoped — `pharmacist-service.ts:988-998`
explicitly declines to invent outbreak prediction. Worth preserving that judgement.

### `pharmacist.index.tsx` — "Pharmacy Dashboard"

| # | Finding | Severity | Fix |
|---|---|---|---|
| PHA-10 | "DISPENSED TODAY" uses UTC days — **C2** | medium | small |
| PHA-11 | No loading state: tiles read "0" while loading | medium | small |
| PHA-12 | `key={`${f.name}-${i}`}` — index in key, a C6 symptom | low | small |

**PHA-11 detail.** `useClinicForecasts` is destructured without `loading`, so
"TOTAL STOCK 0 · 0 medications" renders before the first snapshot — indistinguishable
from an empty pharmacy.

---

## Receptionist

### `receptionist.registration.tsx` — "Patient Registration"

| # | Finding | Severity | Fix |
|---|---|---|---|
| REC-1 | Five captured fields are silently discarded on submit | high | small |
| REC-2 | POPIA consent is checked but never stored | high | small |
| REC-3 | 18 structured fields are concatenated into one free-text note | high | large |
| REC-4 | Form/DB/display terminology diverges three ways | low | small |
| REC-5 | `gender` defaults to `"F"` | low | small |

**REC-1 detail.** These inputs are rendered, bound to state, and **never written
anywhere** — not to `registerPatient`'s arguments and not into `buildRemarks()`:

| Field | Input at | Label |
|---|---|---|
| `residential` | line 298 | residential address |
| `mailing` | line 304 | mailing address |
| `emRel` | line 389 | emergency contact relationship |
| `emAddr` | line 396 | emergency contact address |
| `employerAddr` | line 431 | employer address |

A receptionist types a patient's home address and their emergency contact's
relationship, submits, sees "registered successfully", and the data is gone. The
patient's residential address — the thing you need to reach them — is the most serious
of the five. `telAlt` (line 290) is also lost whenever `telHome` is filled, since
`contactNum: f.telHome || f.telAlt` keeps only one.

**REC-2 detail.** `consent` is validated at line 201 (submission is blocked without it)
but is not in `registerPatient`'s arguments and not in `buildRemarks()`. Only the typed
`signature` name survives, inside the remarks blob. So the system **enforces** consent
at the point of capture and **retains no record** that it was given — no date, no
version of what was consented to, no queryable field. For POPIA that is the wrong way
round: the enforcement is the part you can reconstruct, the record is the part you
cannot.

**REC-3 detail.** `buildRemarks()` (lines 128-143) flattens marital status, occupation,
employer, employer phone, financial classification, scheme, scheme number, dependents,
income, assets, bill payer (name, relationship, phone, address), headman/ward councillor
and the consent signature into one pipe-delimited string, stored as
`medicalRecordsHistory.description` prefixed `"Registration note: "`. The comment is
candid that this is to avoid discarding the data (and it is better than REC-1's silent
loss), but the result is unqueryable: you cannot report on how many patients are
medical-aid funded, and income/assets — which a means-tested fee scale needs as
numbers — are stuck inside prose.

**REC-4 detail.** The form says **District** and **Town**; `registerPatient` maps them to
`city` and `suburb`; `PatientRecordView` displays a single joined **Address**; the patient's
own page says **Cell Phone** where the DB says `contactNum`. Three vocabularies for one
address.

**REC-5 detail.** `gender: "F"` is the initial value, so a receptionist who doesn't touch
the field records every patient as female. An empty default forcing an explicit choice is
safer. Possibly deliberate for a majority-female clinic population — worth asking.

### `receptionist.profiles_.$pid.tsx` — "Patient Profile"

| # | Finding | Severity | Fix |
|---|---|---|---|
| REC-6 | Clearing insurance silently does nothing — **C4** | high | small |
| REC-7 | `"None"` is a sentinel value inside a free-text field | medium | small |
| REC-8 | `insurancePolicyNumber` is duplicated across two collections and can diverge | medium | medium |
| REC-9 | Name is split by whitespace heuristic, destructively | medium | small |
| REC-10 | Edits don't reach other roles' cached views — **C3a** | medium | small |

**REC-6/REC-7 detail.** `fetchPatientRecord` maps a missing policy to the literal string
`"None"` (`clinic-data.ts:1031`). The form shows that in an editable text input. On save,
`form.insurance !== "None" ? trim() : undefined` → `stripUndefined` drops the key → the
write is a no-op. So clearing a policy number appears to work, reports success, and the
old value returns on reload. And a policy legitimately recorded as "None" can never be
saved.

**REC-8 detail.** `insurancePolicyNumber` is written to `patients` *and* mirrored to
`medicalRecords` (lines 183-190), but only `insuranceChanged && recordNo != null`. Since
clearing never counts as a change that writes (REC-6), the two copies drift. Nurses and
doctors read the `medicalRecords` copy; reception reads the `patients` copy.

**REC-9 detail.** `form.name.trim().split(/\s+/)` → `names = parts[0]`,
`surname = parts.slice(1).join(" ")` (lines 148-150). For "Anna Marie Botha" this stores
`names: "Anna"`, `surname: "Marie Botha"`. Because the form field is built by joining
`names + surname`, **re-saving an untouched record silently restructures the name.** Two
inputs (first names / surname) matching the stored shape would remove the guesswork.

### `receptionist.queue.tsx` — "Acute Care Queue"

| # | Finding | Severity | Fix |
|---|---|---|---|
| REC-11 | `queuePace` uses UTC "today" — **C2** | medium | small |
| REC-12 | Triage reasons are appended to the visit-reason string | medium | medium |
| REC-13 | Nav "Acute Queue" vs title "Acute Care Queue" | low | small |

**REC-12 detail.** `addWalkIn` (line ~377) joins the typed reason and every ticked triage
question label into one `reason` string. The `TODO(db)` above `TRIAGE_QUESTIONS`
(line 78-80) already identifies this and proposes a dedicated field. It matters
clinically: the discriminators that produced a triage level are the justification for
it, and they are currently only recoverable by string-matching prose. Worth doing — the
questions are a fixed list, so this is a small schema addition, not an open design
question.

The row itself has real loading, empty, error and offline states and is the only place
in the app with a deliberate 12px floor and 40px touch targets.

### `receptionist.profiles.tsx` — "Patient Profiles"

| # | Finding | Severity | Fix |
|---|---|---|---|
| REC-14 | ID search has no clinic check — `db-issues #24`, open | high | small |

Already specified in `db-issues` with the fix pattern; not re-derived here.

### `receptionist.index.tsx` — "Reception Dashboard"

| # | Finding | Severity | Fix |
|---|---|---|---|
| REC-15 | Only one error path; stat tiles show "0" while loading | medium | small |
| REC-16 | Duplicate `Stat` — **C9** | low | small |

---

## Admin

### `admin.audit.tsx` — "Audit Logs"

| # | Finding | Severity | Fix |
|---|---|---|---|
| ADM-1 | Dismissed flags are shared across admins — **C7** | medium | small |
| ADM-2 | Unresolved server timestamps display as "now" and reorder rows | low | small |

**ADM-2 detail.** `audit.ts:52-58`'s `toIso` falls back to `new Date().toISOString()`
when `timestamp` hasn't resolved. Combined with sorting by `when`
(`admin.audit.tsx:87-89`), a freshly written row briefly shows the current time and sits
at the top, then jumps to its real position. Rendering "…" until the timestamp resolves
would be more honest.

The move of this log from `localStorage` to Firestore is well reasoned
(`audit.ts:15-19`) — the previous version was not an audit trail in any meaningful
sense, and the comment says so.

### `admin.staff.tsx` — "All Staff"

| # | Finding | Severity | Fix |
|---|---|---|---|
| ADM-3 | 7 sub-12px sites; row actions at `py-1`/`py-1.5` — **C10** | medium | small |

### `admin.users.tsx` — "Create User"

| # | Finding | Severity | Fix |
|---|---|---|---|
| ADM-4 | Nav "Create User" vs a page that creates one staff login | low | small |

**ADM-4 detail.** "User" here means a staff login, but "user" elsewhere in the app means
the `users` collection, which is mostly patients. `admin.index.tsx:95-99` has to carry a
note explaining that patients aren't managed here — a sign the label is doing the wrong
work. "Add Staff Member" would need no footnote.

### `admin.index.tsx` — "Admin Dashboard"

| # | Finding | Severity | Fix |
|---|---|---|---|
| ADM-5 | "STAFF ACCOUNTS" shows "0" while loading and on error | medium | small |
| ADM-6 | "ROLES MANAGED: 4" is a constant presented as a metric | low | small |

**ADM-5 detail.** The `useQuery` is destructured as `{ data: clinicStaff = [] }` — no
`isLoading`, no `isError`. A failed staff query is indistinguishable from a clinic with
no staff, permanently.

**ADM-6 detail.** `STAFF_ROLES.length` can never change at runtime. It occupies a third
of the dashboard's primary row where something actionable could be.

---

## Super Admin

### `super-admin.applications.tsx` — "Clinic Applications"

| # | Finding | Severity | Fix |
|---|---|---|---|
| SUP-1 | Mixed date formats on one page | low | small |

**SUP-1 detail.** Both `toLocaleString("en-ZA", …)` and `toLocaleDateString("en-ZA", …)`
appear, so submitted-at and reviewed-at render in different shapes side by side.

### `super-admin.facilities.tsx` — "Facilities"

| # | Finding | Severity | Fix |
|---|---|---|---|
| SUP-2 | "Facilities" here, "Clinics" everywhere else — see the terminology register | medium | small |

### `super-admin.index.tsx` — "Platform Overview"

| # | Finding | Severity | Fix |
|---|---|---|---|
| SUP-3 | Duplicate `Stat`; no empty state | low | small |

---

## Shared components

### `PatientRecordView.tsx` (nurse + doctor)

| # | Finding | Severity | Fix |
|---|---|---|---|
| SH-1 | Allergies and other clinical fields cannot be cleared — **C4** | high | small |
| SH-2 | Clinical notes have no author — **C11** | medium | medium |
| SH-3 | `dosage` is a bare number with no unit, and one per patient | medium | large |
| SH-4 | `historyId: Date.now()` collides within a millisecond | low | small |
| SH-5 | `lastVisit` written to two collections; `as any` cast — `db-issues #21` | low | small |

**SH-3 detail.** `prescription` is one free-text string and `dosage` one number
(`Number(form.dosage)`, line 143). A patient on three medications cannot be represented,
and "500" carries no unit — mg, ml and tablets are indistinguishable in the stored data.
Structuring this means a `prescriptions` subcollection (medicationId → C6, dose amount,
unit, frequency, route, start/end, prescriber), which is the second-largest structural
change after C6 and the one with the most direct clinical risk attached to leaving it.

**SH-4 detail.** Two notes added in the same millisecond get the same `historyId`, which
is also the sort key for the patient's visit history (C11). Unlikely by hand, likely in
any batch or import path.

### `AppShell.tsx`

| # | Finding | Severity | Fix |
|---|---|---|---|
| SH-6 | Sign-out clears three `localStorage` keys and no caches — **C3b**, **C7** | high | small |

---

## Appendix A — Free-text field register

Every field stored as a plain string that would be safer or more useful structured,
with the concrete risk and roughly what structuring involves.

| Field | Stored in | Current type | Risk today | Structuring |
|---|---|---|---|---|
| `medName` | `inventory`, `distributions`, `patientDispensing`, `stockDeliveries.items[]` | free string, exact-matched | Duplicate inventory rows split stock; false reorder alerts; forecasts halve; cross-clinic lookup misses; patient sees contradictory availability (**C6**) | `medications` reference collection (code, generic name, strength, form, unit); `medicationId` as the join key, name denormalised for display. Seed from the SA EML / NAPPI. Needs a de-dup migration. **Large.** |
| `prescription` | `medicalRecords` | one free string | Cannot represent more than one medication; cannot be cross-referenced to inventory; OCR writes into it unvalidated | `prescriptions` subcollection keyed to `medicationId`, one row per medication. **Large.** |
| `dosage` | `medicalRecords` | one bare number | No unit — 500mg and 500ml are identical in storage; one dose per patient | Fold into the `prescriptions` row: `{amount, unit, frequency, route}`. **Large.** |
| `allergies` | `medicalRecords` | one free string | No way to check a prescription against it programmatically; spelling variants aren't equal; cannot be cleared (**C4**) | Array of coded allergens + free-text note for anything unlisted. **Medium.** |
| `bloodType` | `medicalRecords` | free string | Only 8 valid values; typos are silently accepted | Enum dropdown. **Small** — the cheapest win in this table. |
| `bp` | `medicalRecords` | free string (`"120/80"`) | Cannot be charted, trended or compared; no validation on either number | `{systolic: number, diastolic: number, takenAt}`. **Small.** |
| `insurancePolicyNumber` | `patients` **and** `medicalRecords` | free string, `"None"` sentinel | Two copies that diverge (**REC-8**); scheme and number concatenated with `·` at registration; cannot be cleared (**REC-6**) | `{schemeId, planName, memberNo, dependentCode}` in one place. Needs the `db-issues #10` collection decision. **Medium.** |
| Medical aid (patient side) | `localStorage` only | 4 strings | Invisible to staff, lost on cache clear, leaked between patients on a shared device (**C7**) | Same collection as above; delete the `localStorage` path. **Medium.** |
| Registration extras (18 fields) | `medicalRecordsHistory.description` | one pipe-delimited string | Unqueryable; income/assets unusable as numbers for a means-tested fee scale (**REC-3**) | A `patientIntake` document with real fields. **Large.** |
| `chronicCondition` | `patients` | free string | Primary grouping dimension for clinical reporting, spelled by hand | ICD-10 subset dropdown. **Medium.** |
| `reason` (queue) | `queue` | free string with triage labels appended | The discriminators justifying a triage level are only recoverable by string-matching (**REC-12**) | `triageFlags: string[]` beside the reason; the question list is already fixed. **Small.** |
| `note` (dispense) | `patientDispensing` | free string | Already flagged in `db-issues #20` as an open decision | — |
| `category` | `inventory` | free string, `"External"` hardcoded for nurse stock | Unusable as a therapeutic grouping once outside stock exists (**NUR-5**) | Enum, with supplier kept in `source`. **Small.** |
| `source` (supplier) | `stockDeliveries.externalSource` | free string | Same duplicate-by-typo problem as `medName`, for suppliers | `suppliers` collection. **Medium**, lower priority. |

---

## Appendix B — Terminology register

The same real-world thing called different names. Each row is cheap to fix
individually; the value is in picking one word and applying it.

| Concept | Names in use | Where |
|---|---|---|
| A clinic | "Clinic", "Facility", "Clinic" in the DB (`clinics`), `facilityId` on queue entries | Super Admin nav says **Facilities**; everything else says clinic; `queue.facilityId` vs `inventory.clinicId` for the same clinic |
| A notification | "Notifications", "Alerts", "Notifications & Alerts", "UNREAD ALERTS" | patient nav, page title, dashboard tile, quick action |
| A patient list | "Patient Files" (doctor), "Patients" (nurse), "Patient Profiles" (reception) | *Possibly deliberate* — each role sees a different subset for POPIA reasons. Worth confirming rather than changing. |
| The stock page | nav "Stock Levels" → title "Stock Management" (pharmacist); nav "Stock" → title "Stock" (nurse) | AppShell vs route titles |
| The queue | nav "Acute Queue", title "Acute Care Queue", route `/receptionist/queue` | |
| Digitize | `saveDigitizedFile` (live) vs `saveDigitisedRecord` (dead), nav "Digitize Files" vs title "Digitize Patient Files" | -ize/-ise both present |
| A staff member | "User" (admin nav, `users` collection — which is mostly patients), "Staff" (All Staff page), role collections | **ADM-4** |
| A clinician's appointments | `useDoctorAppointments`, used by nurses too | **NUR-7** |
| "Today" | three incompatible definitions | **C2** |
| The fast-lane page | route `pharmacist.diagnostics.tsx`, titled "Fast Lane Handover" | **PHA-3** |

---

## Appendix C — Missing fields and incomplete flows

| # | Gap | Where | Severity |
|---|---|---|---|
| 1 | No author on any clinical note | `medicalRecordsHistory` (**C11**) | medium |
| 2 | POPIA consent enforced but not recorded | registration (**REC-2**) | high |
| 3 | Residential address, mailing address, emergency-contact relationship and address, employer address captured then discarded | registration (**REC-1**) | high |
| 4 | No way to clear a clinical field | **C4** | high |
| 5 | Visit history has no dates | **C11** | medium |
| 6 | One prescription and one dose per patient | **SH-3** | medium |
| 7 | No "ready for collection" state, so the patient is correctly told to "check before travelling" rather than being told a parcel is waiting | `useMedicationStatus` — a deliberate and well-reasoned limit (`patient-service.ts:960-970`), recorded here as a product gap, not a defect | medium |
| 8 | Queue acknowledgement cannot be withdrawn — a patient who taps "I'm on my way" and is then delayed has no way to say so | `PatientCalledCard.tsx` | low |
| 9 | 2FA is a placeholder; the "Reset 2FA" bypass is still present | `db-issues #7`, `#14` — **must be gated before deployment** | high |
| 10 | Anonymous Auth still enabled | `db-issues`, "Confirmed working" section | high |

---

## Appendix D — Doc drift

`docs/db-issues.md`'s "Confirmed working / good design" section states the Firestore
rules are `allow read, write: if request.auth != null`. That is no longer true:
`firestore.rules` is now 226 lines with role helpers (`role()`, `isStaff()`,
`myPatientId()`), per-collection rules, patient-scoped field whitelists and a
deny-by-default catch-all. The same section's warnings about Anonymous Auth and
rule-tightening are still live, but the description of the rules themselves is
several iterations out of date — worth correcting so nobody plans against it.

Two further notes for whoever maintains that file:

- `db-issues #25` (patient listeners with no error handling) is **half resolved**: all
  ten now have error callbacks, but none surface anything to the UI (**C12**).
- `db-issues #2`'s question — is `inventory` per-clinic? — now blocks a *user-visible*
  inconsistency, not just a code smell: two pharmacist pages show clinic stock and two
  show platform-wide stock (**PHA-6**).

---

## Suggested order of work

Nothing here is prescriptive about priority — that is a team call — but the
dependencies run roughly:

1. **C1** (patient appointment times) — small, self-contained, and currently sends
   patients to the clinic two hours late.
2. **C4** (fields cannot be cleared) — small, and one of its instances is a
   patient-safety issue.
3. **C3** (cache clearing + sign-out) — small, and `clearDoctorCache`/`clearNurseCache`
   already exist waiting to be called.
4. **C5** (mock stock fallback) and **C7** (shared `localStorage` keys) — small.
5. **REC-1 / REC-2** (discarded registration fields, unrecorded consent) — small, and
   currently losing real data on every registration.
6. **C2** (one definition of "today") — medium, needs the per-field decision in C2.
7. **C6** (medication reference data) — large, and unlocks PHA-8, SH-3 and the patient
   stock search.

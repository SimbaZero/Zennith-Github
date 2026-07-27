# Zennith — Firestore Issues & Decisions To Raise With The Team

Running log of things found while wiring the pharmacist backend to real Firestore data.
Update this file as we go — don't lose track of anything before raising it with Simba/the DB owner.

---

## 🐞 Bugs (things that are actually wrong / inconsistent)

### 1. `inventory.quantity` is stored as a string, not a number

- **Where:** `inventory` collection, `quantity` field
- **Problem:** Some/most documents have `quantity: "120"` (string) instead of `quantity: 120` (number), while `threshold` is correctly stored as a number. This breaks any math done directly on the field (e.g. summing total stock resulted in string concatenation like `"450120300..."` instead of a real sum).
- **Current workaround:** `src/lib/pharmacist-service.ts` forces both `quantity` and `threshold` through a `toNumber()` helper before use, so the app works regardless of which type Firestore actually has. This is a safe permanent workaround, not just a hack — but the underlying data should still be fixed/standardized at the source (whatever script seeds/writes `inventory` documents).
- **Ask the team:** Standardize `quantity` (and double check `threshold`, and similar numeric fields across other collections) to always be written as a real Firestore **number** type, not a string.

---

## 🧩 Design Gaps (missing pieces, not necessarily "bugs")

### 2. `inventory` has no `clinicId` — no per-clinic stock split

- **Where:** `inventory` collection
- **Context:** The real-world model (confirmed with the team) is: **pharmacist holds central stock → distributes it out to clinics/nurses** via the `distributions` collection. So this may not need fixing at all — but the existing frontend UI (`pharmacist.stock.tsx`) has a clinic selector that implies stock is tracked _per clinic_, which the current schema doesn't support.
- **Current workaround:** Treating `inventory` as one shared central pool (matches the real-world model). The clinic selector UI is left in place but does not currently filter/affect the stock numbers shown — placeholder behavior only.
- **Ask the team:** Confirm this interpretation is correct — inventory is a single central pharmacist stock, and clinic-level breakdown only exists via `distributions` records. If actual per-clinic stock pools are wanted later, this needs a real schema decision (e.g. sub-collections per clinic, or a `clinicId` field with per-clinic quantity tracking).

### 3. No `avgDay` (average daily usage) field on `inventory`

- **Where:** `inventory` collection
- **Context:** `pharmacist.stock.tsx` displays an "Avg/day" figure per medication (used for forecasting/reorder planning). This doesn't exist in Firestore yet.
- **Current workaround:** Temporarily faked/hardcoded in code with a `// TODO(db):` comment marking exactly where — see `src/lib/pharmacist-service.ts`.
- **Ask the team:** Decide whether this should be (a) a real stored field updated periodically, or (b) calculated on the fly from `distributions` history (sum of `unitsGiven` for a med over a date range ÷ number of days). Either is workable — just needs a decision.

---

### 4. No ID counter for `distributions`

- **Where:** `counters` collection only tracks `patientNo`, `recordNo`, `userNo` — nothing for distribution records.
- **Current workaround:** New distribution documents generate `distributionId` from `Date.now()` (a timestamp) instead of a clean sequential number like `1, 2, 3...`. Works fine functionally, just not as tidy as the other ID schemes.
- **Ask the team:** Decide if a real sequential counter is wanted (e.g. add `distributionNo` to the `counters` collection) — would need a Firestore transaction to increment safely.

### 5. No "pending / awaiting confirmation" state for distributions

- **Where:** `distributions` collection has no `status` field.
- **Context:** The original frontend mockup had a two-step flow — pharmacist sends stock to a clinic, then a nurse separately confirms receipt. The real schema only supports a single, immediate, completed distribution event (pharmacist → specific nurse, done in one step).
- **Current decision:** Removed the "Send to Clinic (pending/confirm)" UI section for now — replaced with a direct "Distribute to Nurse" action that writes one completed `distributions` record immediately and deducts real inventory at the same time.
- **Ask the team:** If a two-step pending/confirm workflow is actually wanted, `distributions` needs a `status` field (e.g. `"pending" | "confirmed"`), or a separate collection for in-transit stock.

### 6. Clinics matched by name string, not ID

- **Where:** Frontend's clinic list (`src/lib/clinic.ts`) uses string IDs like `"hillbrow"` and display names like `"Hillbrow CHC"`. Real Firestore `clinics` docs store a numeric `clinicId` and `clinicName`.
- **Current workaround:** Matching clinics between frontend and Firestore by comparing `clinicName` text exactly (e.g. `"Hillbrow CHC"`) — this works today only because the names happen to match exactly.
- **Ask the team:** Longer-term, the frontend should store/reference the real numeric `clinicId` directly instead of relying on name-string matching, which would silently break if anyone ever renames a clinic.

### 12. `pharmacists` has no `clinicId` — unlike `nurses`

- **Where:** `pharmacists` collection.
- **Context:** `nurses` documents already have a `clinicId` field linking each nurse to their clinic — `pharmacists` documents don't. This means there's currently no way to know "which clinic does this logged-in pharmacist belong to," which is the real blocker behind making pharmacist stock/clinic selection actually dynamic (right now every pharmacist sees the same central stock regardless of clinic).
- **Ask the team:** Decide whether pharmacists should be tied to one clinic (add `clinicId`, same pattern as nurses) or whether the "one central stock, multiple clinics draw from it" model is the intended real-world design — this decision also determines whether `inventory` needs a `clinicId` split (see #2).

### 13. New distribution writes are missing the `inventId` field

- **Where:** `distributions` collection.
- **Context:** Older/seeded distribution documents include an `inventId` field (linking back to the specific inventory item). The real writes built in `recordDistribution()` (`pharmacist-service.ts`) don't currently set this field — a minor inconsistency, not breaking anything today, but worth fixing for data consistency.
- **Fix (small, low-risk):** Pass the medication's `inventId` through when calling `recordDistribution()` and include it in the `addDoc(...)` write.

## 🔐 Auth / Login Decisions

### 7. 2FA is still a demo placeholder, not real

- **Where:** `src/routes/two-factor.tsx`
- **Context:** Real SMS-based 2FA via Firebase's Multi-Factor Auth was scoped out and deliberately deferred — it needs an Identity Platform upgrade, a brand-new phone-enrollment flow (doesn't exist yet), reCAPTCHA setup, and has a 10 SMS/day free-tier limit. Too large to build safely alongside everything else.
- **Current state:** The existing screen still accepts any 6 digits and proceeds — fine for demos, not secure.
- **Ask the team / follow-up:** Decide if/when real phone-based 2FA is worth the investment described above, as a dedicated follow-up piece of work.

### 8. No age, gender, or patient "status" field

- **Where:** `users` and `patients` collections.
- **Context:** The original patient dashboard mockup showed age, gender, and a patient "status" (e.g. Active) — none of these exist anywhere in the real schema (`users` has no birthdate/gender field; `patients` has no status field).
- **Current decision:** These fields are simply omitted from the real Medical Record page rather than faked.
- **Ask the team:** Decide if these are needed — if so, they'd need adding to `users` (e.g. `dateOfBirth`, `gender`) and/or `patients` (e.g. `status`).

### 9. `medicalRecordsHistory` has no date field

- **Where:** `medicalRecordsHistory` collection.
- **Context:** Used for "Visit History" — only has `historyId`, `description`, `medicalRecordNo`, `patientId`. No timestamp, so visits can only be ordered by `historyId` (assumed to increase over time), not shown with an actual date.
- **Ask the team:** Add a real date/timestamp field if chronological display matters.

### 10. Medical Aid details have no backing collection

- **Where:** `patient.medical-record.tsx`'s "Medical Aid Details" section.
- **Context:** This entire feature (provider, scheme, member number, private-pay toggle) has no matching Firestore collection — it's staying as a `localStorage`-only mock for now, unchanged.
- **Ask the team:** If this needs to be real and shared across devices/sessions, it needs a new collection (e.g. a `medicalAid` field on `patients`, or its own collection).

### 11. `notifications` has no "type" field

- **Where:** `notifications` collection.
- **Context:** The original mock alerts UI color-coded alerts by type (stock/appointment/redirect). Real notifications only have `title`, `message`, `timeSent`, `isRead`, `notifId`, `userId` — no category field to color-code by.
- **Current decision:** All real notifications now render with one neutral style instead of a fabricated type.
- **Ask the team:** Add a `type` field if category-based styling/filtering is wanted later.

### 14. "Reset 2FA" button is a deliberate dev-only bypass

- **Where:** `src/routes/two-factor.tsx`.
- **Context:** Anyone who knows an account's password can wipe its 2FA secret and re-enroll a new authenticator — necessary right now since shared team/demo accounts get permanently locked to whichever device first scanned the QR code, with no other recovery path.
- **Ask the team:** This must be removed or gated behind admin approval before any real deployment — it's explicitly labeled "dev/testing only" in the UI as a reminder.

### 15. Password reset emails use Firebase's default (unbranded) template

- **Where:** Firebase Auth email settings.
- **Context:** Reset emails currently come from `noreply@zennith-d6faa.firebaseapp.com` using Firebase's generic template — confirmed working, but lands in Spam and looks unbranded.
- **Ask the team:** Customize the sender name/template in Firebase Console (Authentication → Templates), and consider a custom domain, before relying on this for real users.

## ✅ Confirmed working / good design (no action needed)

- Firestore connection, config, and security rules (`allow read, write: if request.auth != null`) all work correctly.
- Collections (`inventory`, `distributions`, `reorders`, `pharmacists`, etc.) are otherwise sensibly modeled and match real pharmacist workflows.
- Anonymous Auth is currently enabled for local testing only — **must be disabled before production**, since the current security rule allows any authenticated (including anonymous) user to read/write everything, including sensitive collections like `medicalRecords` and `patients`.

---

_(Keep adding to this as we find more — nothing gets fixed silently, everything goes here first.)_

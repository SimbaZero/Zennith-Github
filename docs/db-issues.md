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
- **Context:** The real-world model (confirmed with the team) is: **pharmacist holds central stock → distributes it out to clinics/nurses** via the `distributions` collection. So this may not need fixing at all — but the existing frontend UI (`pharmacist.stock.tsx`) has a clinic selector that implies stock is tracked *per clinic*, which the current schema doesn't support.
- **Current workaround:** Treating `inventory` as one shared central pool (matches the real-world model). The clinic selector UI is left in place but does not currently filter/affect the stock numbers shown — placeholder behavior only.
- **Ask the team:** Confirm this interpretation is correct — inventory is a single central pharmacist stock, and clinic-level breakdown only exists via `distributions` records. If actual per-clinic stock pools are wanted later, this needs a real schema decision (e.g. sub-collections per clinic, or a `clinicId` field with per-clinic quantity tracking).

### 3. No `avgDay` (average daily usage) field on `inventory`
- **Where:** `inventory` collection
- **Context:** `pharmacist.stock.tsx` displays an "Avg/day" figure per medication (used for forecasting/reorder planning). This doesn't exist in Firestore yet.
- **Current workaround:** Temporarily faked/hardcoded in code with a `// TODO(db):` comment marking exactly where — see `src/lib/pharmacist-service.ts`.
- **Ask the team:** Decide whether this should be (a) a real stored field updated periodically, or (b) calculated on the fly from `distributions` history (sum of `unitsGiven` for a med over a date range ÷ number of days). Either is workable — just needs a decision.

---

## ✅ Confirmed working / good design (no action needed)
- Firestore connection, config, and security rules (`allow read, write: if request.auth != null`) all work correctly.
- Collections (`inventory`, `distributions`, `reorders`, `pharmacists`, etc.) are otherwise sensibly modeled and match real pharmacist workflows.
- Anonymous Auth is currently enabled for local testing only — **must be disabled before production**, since the current security rule allows any authenticated (including anonymous) user to read/write everything, including sensitive collections like `medicalRecords` and `patients`.

---

*(Keep adding to this as we find more — nothing gets fixed silently, everything goes here first.)*

# Zennith — Firebase Setup & Operations

Project: **zennith-d6faa** · Firestore database region: `africa-south1`

## 1 · One-time console setup

1. **Authentication → Sign-in method** → enable **Email/Password**.
2. **Firestore Database** → Create database (if not already created).
3. **Rules** — see [Security rules](#3--security-rules) below.
4. (Deploying?) **Authentication → Settings → Authorized domains** → add your
   production domain.

## 2 · Environment config

`.env` at the repo root, **plain `KEY=value` lines** (no quotes, no commas —
pasting the JS config object from the console breaks every value):

```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=zennith-d6faa.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=zennith-d6faa
VITE_FIREBASE_STORAGE_BUCKET=zennith-d6faa.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

`.env` is gitignored. The Firebase *web* API key is not a secret (security
comes from rules), but keeping it out of the repo is good hygiene.

## 3 · Security rules

**Current (development):** any signed-in user can read/write everything.

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

**Before demo day / any public deployment**, tighten per role. Example shape
(role read from the caller's profile):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function role() {
      return get(/databases/$(database)/documents/profiles/$(request.auth.uid)).data.role;
    }
    match /profiles/{uid} {
      allow read: if request.auth != null;
      allow write: if request.auth.uid == uid || role() == 'admin';
    }
    match /medicalRecords/{id} {
      allow read, write: if role() in ['doctor', 'nurse'];
    }
    match /inventory/{id} {
      allow read: if request.auth != null;
      allow write: if role() == 'pharmacist';
    }
    // …repeat per collection; default-deny everything else
    match /{document=**} {
      allow read: if request.auth != null;
      allow write: if false;
    }
  }
}
```

Note the `get()` call costs one extra read per request — acceptable here.

## 4 · Scripts

Both scripts read `.env` themselves and use the client SDK, so the **rules must
allow the operations** (the dev rules above do). Node 20+.

### `node scripts/seed-users.mjs`

Creates the six demo role accounts (`doctor@zennith.test` … `admin@zennith.test`,
password `password`) in Firebase Auth and writes their `profiles` docs
(`builtin: true`). Idempotent: if an account exists with the expected password,
its profile is refreshed; if it exists with a *different* password, the script
tells you to delete it in the console first.

### `node scripts/migrate-logins.mjs [--all]`

Bridges the imported dataset to real logins:

1. Reads all `userCredentials` (userName/password) and `users` (role, names).
2. Picks 2 people per role (or everyone with `--all`).
3. Creates a Firebase Auth account per person — `<userName>@zennith.test`, or
   the userName itself when it's already an email.
4. Writes `profiles/{uid}` with role, fullName, and `legacyUserId`.

**Passwords:** most `userCredentials` rows store bcrypt *hashes*, which cannot
be reversed — those accounts get the demo password **`password123`**. Rows with
a usable plaintext password keep it. Accounts accidentally created with a hash
as their password in earlier runs are repaired automatically.

## 5 · Everyday operations

| Task | How |
|---|---|
| Create a staff login | Admin portal → Create User (creates Auth account + profile without logging the admin out) |
| Block a staff login | Admin portal → All Staff → delete (removes profile → login rejected). Fully delete the Auth record under Authentication → Users |
| Reset a password | Console → Authentication → Users → ⋮ → Reset password (or delete + recreate) |
| Reset someone's 2FA | Firestore → `profiles` → their doc → delete the `totpSecret` field → next login re-enrolls |
| Register a walk-in patient | Receptionist portal → Registration (allocates IDs via `counters/registration`, creates `users` + `patients` + `medicalRecords`) |
| Give a registered patient a login | Currently manual: create the Auth user (console or admin portal), then set `legacyUserId` on their profile to the patient's `userId` |
| Book an appointment | Doctor portal (own schedule) or Receptionist portal (any clinician, `Doc-N`/`Nur-N`) |

## 6 · Gotchas learned the hard way

- **`.env` format** — pasting the console's JS config object produces values
  like `"zennith-d6faa",` and every Firestore call fails with
  `PERMISSION_DENIED: Permission denied on resource project` (reason
  `CONSUMER_INVALID`). That error means *malformed project ID*, not rules.
- **Locked-mode Firestore** — a database created in production mode denies all
  client access until you publish rules; the imported data got in via import
  tooling, which bypasses rules.
- **`auth/email-already-in-use` + unknown password** — the client SDK cannot
  reset another user's password; delete the account in the console and rerun
  the script.
- **Firestore `quantity` strings** — the imported inventory stores numbers as
  strings; `clinic.ts` normalises with `Number()` on read and writes real
  numbers back.
- **`appointments.clinician` mixes doctors and nurses** (`Doc-N` / `Nur-N`) —
  filter accordingly, and don't assume usernames encode the person's role
  (dataset usernames like `doc51_40` can belong to nurses).

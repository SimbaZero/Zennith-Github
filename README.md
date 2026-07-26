# Zennith Health Services

A role-based clinic management system for South African community health centres,
built as an Information Systems project. Seven roles — doctor, nurse, patient,
pharmacist, receptionist, admin, and **super_admin** (platform owner) — each get
their own portal, backed by Firebase Authentication and Cloud Firestore.

On top of the per-role portals it provides **multi-facility support**: a platform
owner registers facilities and assigns a facility admin to each, staff accounts are
bound to a facility, and an **audit log** records account and settings changes
per facility.

> **Note on the codebase:** this repo is the result of merging two development
> branches — the Firebase/live-data/2FA/email backend work and the
> multi-facility/audit/super-admin platform work. See
> [Two `clinic` modules](#two-clinic-modules) below, which is the one naming
> subtlety that merge introduced.

**Documentation**

| Doc | What's in it |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Tech stack, authentication flow (incl. 2FA), Firestore data model, data-access layer, feature status |
| [docs/FIREBASE.md](docs/FIREBASE.md) | Firebase console setup, security rules, seed/migration scripts, account operations |

---

## Tech stack

- **React 19 + TypeScript** on **Vite 7**
- **TanStack Start / Router** — file-based routing with SSR, deployed as a **Cloudflare Worker**
- **TanStack Query** — server-state caching for all Firestore reads/writes
- **Tailwind CSS 4 + shadcn/ui** — styling and UI primitives
- **Firebase** — Authentication (email/password) and Cloud Firestore (database `africa-south1`)

## Two `clinic` modules

The merge left two similarly-named modules with **different jobs** — check which one
you need before importing:

| Module | Purpose |
|---|---|
| `src/lib/clinic.ts` | **Multi-facility selector** — the `CLINICS` list, `useActiveClinic()`, `ClinicId`, `splitByClinic()`. localStorage-backed; drives the clinic switcher in `AppShell` and the picker on the login screen. |
| `src/lib/clinic-data.ts` | **Firestore data-access layer** — all live queries and writes (`fetchDoctorDashboard`, `fetchInventory`, `distributeStock`, `registerPatient`, `signUpPatient`, …). |

## Quick start

```bash
npm install
cp .env.example .env        # fill in your Firebase web app config (plain KEY=value lines)
npm run dev                 # http://localhost:8080 (or next free port)
```

First-time Firebase setup (console + seeding) is covered step-by-step in
[docs/FIREBASE.md](docs/FIREBASE.md). In short: enable Email/Password sign-in,
create a Firestore database, then run:

```bash
node scripts/seed-users.mjs      # creates the six demo role accounts
node scripts/migrate-logins.mjs  # creates logins for people in the imported dataset (2 per role; --all for everyone)
```

## Signing in

Login is **username + password + authenticator-app 2FA**. A bare username maps to
`<username>@zennith.test` behind the scenes; a full email address is used as-is.
Every account below uses password `password`, and each username matches its role.

| Username | Role | Name |
|---|---|---|
| `doctor` | doctor | Sarah Mokoena |
| `doctor2` | doctor | James Naidoo |
| `nurse` | nurse | Thandi Dlamini |
| `nurse2` | nurse | Nomsa Khumalo |
| `patient` | patient | Sipho Ndlovu |
| `patient2` | patient | Lerato Molefe |
| `pharmacist` | pharmacist | David Pillay |
| `pharmacist2` | pharmacist | Grace Botha |
| `receptionist` | receptionist | Michael van Wyk |
| `admin` | admin | Admin User |
| `superadmin` | super_admin | Platform Owner — facilities + platform-wide audit log |

> The database was reduced to this clean 10-account demo set with
> `scripts/reset-to-demo.mjs`. To rebuild it (or reset after experimenting),
> re-run that script.

On first login each account walks through **2FA enrollment**: add the shown setup
key to Google Authenticator (or any TOTP app), then enter the app's 6-digit code.
Every later login requires the current rotating code. To reset someone's 2FA,
delete the `totpSecret` field from their document in the `profiles` collection.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | Production build (Cloudflare Worker output in `.output/`) |
| `npx tsc --noEmit` | Type-check the whole project |
| `node scripts/seed-users.mjs` | Seed/repair the six demo role accounts (Auth + `profiles`) |
| `node scripts/migrate-logins.mjs [--all]` | Create real logins from an imported `userCredentials`/`users` dataset (no-op now the dataset is reset) |
| `node scripts/reset-to-demo.mjs` | Reduce the database to the clean 10-account demo set (keeps inventory + one clinic) |
| `node scripts/generate-demo-data.mjs` | Top every collection up to ~10 records (data-only rows; keeps the 10 logins) |
| `node scripts/create-superadmin.mjs` | Create/repair the `superadmin` platform-owner account (additive; touches nothing else) |

## Confirmation email (Resend)

Patient self-signup sends a welcome/confirmation email through
[Resend](https://resend.com) — Firebase's built-in auth email proved unreliable
(unauthenticated sender, rate-limited, frequently dropped by Gmail). The send
happens server-side in [src/lib/welcome-email.ts](src/lib/welcome-email.ts) (a
TanStack Start server function), so the API key never reaches the browser.

**Setup:**
1. Create a free Resend account and an API key (Resend dashboard → API Keys).
2. Add it to `.env` as `RESEND_API_KEY=...` (no `VITE_` prefix — that's what keeps it server-only). Restart `npm run dev`.
3. Until you verify a domain in Resend, the default sender `onboarding@resend.dev` only delivers to **your own** Resend account email. To email arbitrary patients, verify a domain in Resend and set `RESEND_FROM="Zennith <no-reply@yourdomain>"`.
4. Production (Cloudflare): set the secret with `npx wrangler secret put RESEND_API_KEY` (and optionally `RESEND_FROM`).

If `RESEND_API_KEY` is unset, signup still works — the email is skipped and the UI says so.

## Deployment

`npm run build` produces a Cloudflare Workers bundle (config in `wrangler.jsonc`,
server entry `src/server.ts`). Deploy with `npx wrangler deploy` after
authenticating the Wrangler CLI. Remember to add your production domain to
Firebase Authentication → Settings → Authorized domains.

## Project layout (abridged)

```
src/
├── components/          Shared UI (AppShell nav shell, PatientRecordView, shadcn/ui)
├── context/             AuthContext — Firebase session + role state
├── lib/
│   ├── auth.ts          Sign-in, role cache, user CRUD, TOTP secret storage
│   ├── clinic.ts        All Firestore domain queries/mutations (see ARCHITECTURE.md)
│   ├── totp.ts          RFC 6238 TOTP implementation (2FA)
│   ├── data.ts/store.ts Legacy mock dataset — still feeds the pages not yet migrated
│   └── …                notifications, search index, offline helpers
├── routes/              File-based routes: <role>.tsx layout + <role>.<page>.tsx per portal
├── firebase.ts          Firebase app/auth/Firestore initialisation from .env
└── server.ts            Cloudflare Worker SSR entry with error page fallback
scripts/                 seed-users.mjs · migrate-logins.mjs
```

## Known limitations

- Client-side 2FA and role checks are **demo-grade** — see the Security section of
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the production path.
- Deleting a staff member removes their profile (blocks login) but the Firebase
  Auth record must be deleted in the console (client SDKs can't delete other users).
- Some pages still render mock data — the status table in ARCHITECTURE.md tracks
  exactly which.

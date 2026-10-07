<div align="center">

<img src="./src/assets/zennith-logo.png" alt="Zennith logo" width="200"/>

# Zennith

**Clinic management for South African public clinics — one system for patients, nurses, doctors, pharmacists, receptionists, clinic admins and a platform super-admin.**

</div>

---

## What Zennith is

Zennith is a clinic management system built for South African public health clinics. It
puts the people who run a clinic — reception, nursing, pharmacy, doctors, admin — and the
patients they see on one live system, so the queue, the medication stock and the patient
record are the same thing to everyone looking at them.

It is a final-year Information Systems project at the University of Johannesburg, built
by a team of eight and piloted against Hillbrow Community Health Centre.

---

## What it does

**Live acute queue with guided triage.** Reception answers observable yes/no questions —
"heavy bleeding that won't stop", "can't speak in full sentences" — and the system
computes the triage level from them, using the discriminators from the real South African
Triage Scale. Reception staff aren't clinically trained, so they are never asked to judge
how sick someone is. They can escalate a level on instinct; they can't lower one.

**Pharmacy delivery workflow where stock exists in exactly one place.** Stock is deducted
from the pharmacy the moment a delivery is sent, and only added to the clinic once a nurse
confirms what physically arrived. A mismatch between what was sent and what landed
requires a written explanation before it can be accepted, so a short delivery leaves a
record instead of a quiet discrepancy.

**Inventory forecasting from real dispensing history.** Days of stock remaining, reorder
points and suggested order quantities, calculated from what has actually been handed to
patients over the last 30 days — not from invented demand figures. When a
pharmacist-set threshold is crossed, a reorder notification is raised automatically.

**Fast Lane.** A nurse or doctor can mark a stable chronic patient as able to collect
their repeat medication straight from the pharmacist, without queuing through a nurse
first. This is the clinician's own judgement and nothing else: the patient's dose-taking
history is shown as evidence to weigh, the way a blood-pressure reading is evidence. No
score decides it, and nothing sets the flag automatically.

**Notifications for every role, not just patients.** Overdue triage alerts to reception,
stock and reorder alerts to pharmacy and clinic admins, appointment reminders to patients
(by SMS, on a scheduled job). When a patient is called, they get an **"I'm on my way"**
button — an acknowledgement, kept strictly separate from "in room" status, which only
staff can set. A patient can never move themselves through the queue.

**POPIA-aligned privacy.** Patients choose which of their personal fields staff can see,
and staff pages honour those choices field by field. A patient can request account
deactivation, which goes to an admin for review rather than deleting anything
automatically — clinics are legally required to retain medical records for a defined
period, so "delete my account" cannot mean "destroy the record".

**Real South African ID validation.** Luhn checksum over the first twelve digits,
date-of-birth decode with a real-date check, and a citizenship digit that accepts `0`
(citizen), `1` (permanent resident) **and `2` (refugee)**. Rejecting `2` would turn away
refugee patients, so it is accepted deliberately — see the comment in
`src/lib/sa-id.ts` before "tidying" it.

**Offline-tolerant, not offline-first.** A service worker keeps the app itself usable
without a connection: records, schedules and stock you have already loaded stay on
screen, and refreshing doesn't break the page. Writes that are safe to queue do queue and
sync on reconnect. Actions that genuinely need the server — dispensing medication,
booking an appointment, creating an account — **refuse clearly instead of appearing to
work**, because only the server can confirm real stock or issue a real patient ID.

**A public live queue, no login.** The landing page shows how busy each clinic is right
now, so someone can decide whether to travel. Read-only, counts only, never names.

---

## Tech stack

| Layer | Choice |
|---|---|
| UI | React 19 + TypeScript |
| App framework | TanStack Start (SSR) |
| Routing | TanStack Router — file-based, `src/routes/` |
| Server state | TanStack Query |
| Styling | Tailwind CSS v4 |
| Components | shadcn/ui on Radix primitives |
| Forms | React Hook Form + Zod |
| Charts | Recharts |
| PDF | jsPDF (client-side, selectable text) |
| Auth | Firebase Auth (email/password) + RFC 6238 TOTP |
| Database | Cloud Firestore, with IndexedDB persistence for offline |
| Build | Vite 7 |
| Package manager | Bun |
| Deploy target | Cloudflare Workers, via Nitro |

### ⚠️ Do not add plugins to `vite.config.ts`

The build config is `@lovable.dev/vite-tanstack-config`, which already bundles
`tanstackStart`, `viteReact`, `tailwindcss`, `tsConfigPaths`, the Cloudflare plugin, env
injection, the `@` path alias and React/TanStack dedupe. **Adding any of those manually
breaks the build with duplicate plugins.** If you need extra Vite config, pass it through
`defineConfig({ vite: { ... } })`. Nitro-level plugins go in `nitro.config.ts`, not
`vite.config.ts`.

This is also why the service worker is hand-written in `public/sw.js` rather than
generated by a plugin — files in `public/` are served untouched and change nothing about
how the app builds.

---

## Getting started

### Prerequisites

- [Bun](https://bun.sh/) — `curl -fsSL https://bun.sh/install | bash`, then restart your
  terminal and check `bun --version`
- Node.js — the scripts in `scripts/` run under Node, not Bun

### Install

```bash
git clone <repo-url>
cd Zennith-Github
bun install
```

Run `bun install` again only when `package.json` changes.

### Environment variables

Copy `.env.example` to `.env` and fill it in. `.env.example` is the authoritative list
and carries a comment per variable explaining what reads it.

```bash
cp .env.example .env
```

The browser-side Firebase keys are the only ones required to run the app:

```
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

Everything else in `.env.example` is optional and switches a feature on: `RESEND_API_KEY`
for patient signup emails, `SMSPORTAL_*` and `FIREBASE_SERVICE_ACCOUNT` for SMS
appointment reminders, `VITE_GEMINI_API_KEY` for OCR on the Digitize Files page. The
server-side ones have no `VITE_` prefix on purpose — that prefix would publish them in
the browser bundle. In production set them with `wrangler secret put NAME`.

Two things that cost people an afternoon:

- **Plain `KEY=value` lines only.** Pasting the JavaScript config object out of the
  Firebase console corrupts every value and surfaces later as a misleading
  `PERMISSION_DENIED`.
- **Restart the dev server after editing `.env`.** Vite reads it at startup; a browser
  refresh won't pick up a new value.

Firebase console setup and security rules: [docs/FIREBASE.md](docs/FIREBASE.md).
Data model: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
**Known schema gaps and open decisions — read before assuming a field exists:**
[docs/db-issues.md](docs/db-issues.md).

---

## Running it

There are two run paths, and which one you need depends on whether you care about
offline behaviour.

### Development

```bash
bun run dev
```

Hot reload, source maps, fast. **The service worker is not registered in dev** — the
registration in `src/routes/__root.tsx` is behind `import.meta.env.PROD`, so the whole
block is stripped from the dev bundle. That is deliberate: Vite serves modules fresh on
every edit, and a worker caching `/assets/*` would serve yesterday's code back while
looking like your changes simply stopped applying.

So **you cannot test offline behaviour in dev mode.** There is nothing to turn on; the
code isn't there.

### Production build, and testing offline

```bash
bun run build
bun run preview
```

`preview` serves the real production build with the service worker active. To test
offline: load a few pages first so they get cached, then switch the browser to offline
(DevTools → Network → Offline, or turn off Wi-Fi) and keep using it. Pages you visited
should still render, Firestore should serve what it cached, and the actions that need the
server should tell you plainly that they can't run rather than hanging or silently
failing.

`bun run build:dev` builds with development mode settings — useful when you need a build
artifact without production optimisations.

### Type checking

There is **no `typecheck` script** in `package.json`. Run the compiler directly:

```bash
npx tsc --noEmit -p tsconfig.json
```

### Every script that exists in `package.json`

| Command | What it does |
|---|---|
| `bun run dev` | Dev server, no service worker |
| `bun run build` | Production build |
| `bun run build:dev` | Build in development mode |
| `bun run preview` | Serve the production build locally — use this for offline testing |
| `bun run lint` | ESLint |
| `bun run format` | Prettier, writes in place |

That is the complete list. There is no `test` script (the project has no test suite yet)
and no `deploy` script — deployment goes through Nitro's Cloudflare output, which
`bun run build` prints the command for.

---

## Test logins

Auth is real Firebase Authentication. A username without an `@` is mapped to
`<username>@zennith.test` by `toEmail()` in `src/lib/auth.ts`. Every seeded account uses
the password **`password`**.

| Role | Username |
|---|---|
| Doctor | `doctor` |
| Nurse | `nurse` |
| Receptionist | `receptionist` |
| Patient | `patient` |
| Pharmacist | `pharmacist` |
| Clinic admin | `admin` |
| Super admin | `superadmin` |

Usernames must match exactly — lowercase, no variations. `reset-to-demo.mjs` also creates
second accounts for several roles (`doctor2`, `nurse2`, `patient2`, `pharmacist2`), which
is what you want for testing anything cross-clinic.

> ### 🔐 Two-factor authentication is real
>
> After the password step, the **first** login for each account shows a QR code. Scan it
> with Google Authenticator, Authy or Microsoft Authenticator and enter the 6-digit code
> to enrol. Every login after that needs the current rotating code — typing random digits
> does not work.
>
> To reset an account's 2FA, delete the `totpSecret` field from its document in the
> Firestore `profiles` collection. There is also a reset button on the two-factor screen,
> which is a **development-only bypass** and must be removed before any real deployment
> (see Known limitations).

---

## Demo data

All of these run under Node, from the project root, and read `.env` directly:

```bash
node scripts/<name>.mjs
```

### Fresh setup, in this order

```bash
node scripts/seed-users.mjs                 # 6 role logins (doctor, nurse, patient, pharmacist, receptionist, admin)
node scripts/create-superadmin.mjs          # the superadmin account, which seed-users does not create
node scripts/setup-clinic-id-counter.mjs    # ID counters, so new clinics/staff get non-colliding numeric IDs
node scripts/setup-staff-id-counters.mjs
node scripts/link-patient-profiles.mjs      # writes patientId onto patient profiles — security rules need it
node scripts/generate-demo-data.mjs         # tops every collection up to ~10 rows
node scripts/generate-dispensing-history.mjs # 30 days of dispensing, so forecasting has a usage rate
```

Then add whichever module you're demoing:

```bash
node scripts/generate-nurse-demo-data.mjs        # 2 dense clinics, ~30 patients each
node scripts/generate-doctor-demo-data.mjs       # a full week of appointments for both doctors
node scripts/generate-receptionist-demo-data.mjs # a busy walk-in queue, including completed visits
```

All of the above are additive and idempotent — they use fixed IDs, so re-running
overwrites the rows they created rather than piling up duplicates.

`generate-nurse-demo-data.mjs` is the one to run before a presentation. The default
`generate-demo-data.mjs` spreads records thinly across up to 10 clinics, so no single
clinic looks busy.

### Starting over

```bash
node scripts/reset-to-demo.mjs   # DESTRUCTIVE
```

Wipes most collections and rebuilds a clean 11-account demo set (the seven roles above
plus `doctor2`, `nurse2`, `patient2`, `pharmacist2`). It keeps the pharmacy inventory and
one clinic. Every account re-enrols 2FA on next login. This is the only destructive
script in the directory.

### Everything else in `scripts/`

Grouped by what they are, because the directory is 26 files and not all of them touch the
database:

- **Read-only audits** — safe any time, write nothing: `audit-clinic-ids.mjs`,
  `audit-clinic-mappings.mjs`, `list-admins.mjs`, `find-duplicate-inventory.mjs`
- **One-time migrations**, all safe to re-run: `migrate-logins.mjs`,
  `migrate-staff-clinicids.mjs`, `fix-doctors-missing-clinicid.mjs`,
  `fix-admin-clinicid.mjs`, `fix-inventory-number-types.mjs`
- **Targeted repairs** — these act on a hardcoded list rather than matching a pattern,
  and `cleanup-orphan-accounts.mjs` makes you type `YES` first:
  `cleanup-orphan-accounts.mjs`, `merge-duplicate-inventory.mjs`
- **Test-data helpers**: `create-patient3.mjs`,
  `fix-pharmacist-multiclinic-testdata.mjs`
- **Codemods, not database scripts** — these rewrite files under `src/`, so run them on a
  clean tree and read the diff: `add-listener-error-handlers.mjs`,
  `use-offline-transactions.mjs`

Each script's header comment explains what it does and why; read it before running
anything that writes.

---

## Project structure

```
src/
├── routes/      file-based routes — the filename is the URL
├── lib/         all data access and domain logic, one service per role
├── components/  shared UI, including the authenticated shell
├── server/      Cloudflare Worker code: SMS reminders, API routes, Firestore admin
├── firebase.ts  Firebase init, with IndexedDB persistence for offline
└── styles.css   Tailwind entry and the app's animations
```

**`src/routes/`** — TanStack Router's file-based convention, where dots become path
segments: `pharmacist.stock.tsx` serves `/pharmacist/stock`, `doctor.patients.tsx` serves
`/doctor/patients`, and `$pid` in a filename is a route parameter. Each role has a layout
route (`nurse.tsx`) plus its pages. Pages hold presentation and user interaction; the
data comes from `src/lib/`.

**`src/lib/`** — one service module per role (`patient-service.ts`, `nurse-service.ts`,
`doctor-service.ts`, `pharmacist-service.ts`, `super-admin-service.ts`), plus
`clinic-data.ts`, which is the shared Firestore layer for queue, patients, appointments
and registration. Cross-cutting concerns live in their own small modules: `auth.ts`,
`notify.ts`, `audit.ts`, `offline.ts`, `sa-id.ts`, `reminders.ts`, `fast-lane.ts`,
`clinic-time.ts`. **`clinic-data.ts` is 2,600 lines and `pharmacist-service.ts` 1,800 —
grep before adding a function, the one you want often already exists.**

**`src/components/`** — `AppShell.tsx` is the authenticated layout (sidebar, header,
notification bell, offline indicator) used by every signed-in page.
`PatientRecordView.tsx` is the patient record shared by the nurse and doctor modules.
`ui/` is shadcn/ui's generated primitives — treat those as vendored and change them
sparingly.

`docs/` carries the written history: [db-issues.md](docs/db-issues.md) (schema gaps and
open decisions), [FIREBASE.md](docs/FIREBASE.md), [ARCHITECTURE.md](docs/ARCHITECTURE.md),
[ADDING-DATA.md](docs/ADDING-DATA.md) and [audit-findings.md](docs/audit-findings.md).

---

## Known limitations

These are real and deliberate, documented here rather than discovered later. None of them
should survive a production deployment.

**Clinic scoping is enforced in the app's queries, not in the security rules.** Every
list query filters by the signed-in user's `clinicId`, so the app shows the right data.
But Firestore evaluates a *list* rule with no document to inspect, so a rule cannot
filter a collection by document contents — it can only allow or deny the whole query.
A determined staff member could therefore query across clinics outside the app. The real
fix is restructuring data under per-clinic paths (`clinics/{id}/patients/...`), which is
a schema change, not a rule change.

**The `users` collection is publicly readable.** Signup has to check whether an ID number
is already registered *before* a session exists, and with no backend there is nowhere
else to answer that. It exposes names and ID numbers. The proper fix is a server function
that answers "is this ID taken?" without returning the data.

**Anonymous Auth is still enabled** on the Firebase project, from local testing. Disable
it before any real deployment.

**The 2FA reset button is a development bypass.** It clears `totpSecret` for the current
account with no verification. Remove or gate it before deployment.

**The Gemini OCR key is exposed client-side.** The Digitize Files feature reads
`VITE_GEMINI_API_KEY`, and the `VITE_` prefix means it ships in the browser bundle.
Separately, Gemini's free tier permits Google to use submitted content to improve their
products, so it has only ever been tested with synthetic patients. Both problems are
solved by the same fix: move the call behind a backend. Do not put real patient
photographs through it as it stands.

A fuller running log — including schema gaps, fields that don't exist yet and decisions
still open — is in [docs/db-issues.md](docs/db-issues.md), with a page-by-page audit in
[docs/audit-findings.md](docs/audit-findings.md).

---

## Team

Zennith is a final-year Information Systems capstone project at the **University of
Johannesburg**, built by a team of eight students and piloted against **Hillbrow
Community Health Centre**. The team is credited on the landing page of the running app.

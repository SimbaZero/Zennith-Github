# Zennith — Test Login Profiles

All accounts use real Firebase Authentication + real Cloud Firestore data — nothing here is hardcoded or mocked. Password for every account below is: password

First login on any account shows a real 2FA QR code — scan it with Google Authenticator (or similar) to activate, then use the rotating 6-digit code on every login after that.

---

## Doctor

| Username | Real Name    | Clinic       |
|----------|--------------|--------------|
| doctor   | Sarah Mokoena | Hillbrow CHC |
| doctor2  | James Naidoo  | Berea CHC    |

Real appointments spread across last week through next week, real clinic-scoped Patient Files, Edit Record (no Dispense).

---

## Nurse

| Username | Real Name      | Clinic       |
|----------|----------------|--------------|
| nurse    | Thandi Dlamini | Hillbrow CHC |
| nurse2   | Nomsa Khumalo  | Berea CHC    |

Each has ~30 real patients, real inventory stock for Dispense Medication, real week-view appointments, camera + Gemini OCR digitize.

---

## Receptionist

| Username     | Real Name      | Clinic       |
|--------------|----------------|--------------|
| receptionist | Michael van Wyk | Hillbrow CHC |

Real walk-in queue (5 seeded entries across triage levels), real audit log, real patient registration and profile editing.

---

## Patient

| Username | Real Name        | Clinic       | Notes |
|----------|------------------|--------------|-------|
| patient  | (built-in demo)  | —            | Original seed account |
| patient2 | (built-in demo)  | —            | Second seed account |
| patient3 | Karabo Sithole   | Hillbrow CHC | Created this session — real record, real notifications |

---

## Other roles (not part of today's testing, but real logins)

| Username    | Role         |
|-------------|--------------|
| pharmacist  | Pharmacist   |
| pharmacist2 | Pharmacist   |
| admin       | Admin        |
| superadmin  | Super Admin  |

---

## If data ever looks thin again

Re-run any of these (all safe to re-run, none of them wipe existing data):

```
node scripts/generate-nurse-demo-data.mjs
node scripts/generate-receptionist-demo-data.mjs
node scripts/generate-doctor-demo-data.mjs
```
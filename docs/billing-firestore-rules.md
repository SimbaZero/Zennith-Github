# Billing: Firestore rules and indexes to apply

These are NOT in `firestore.rules` yet. Apply them yourself. Until they are
applied, every billing save is refused, because the last rule in the file
denies anything not listed.

## Where to paste

In `firestore.rules`, paste the block below **just above** this existing part
near the end of the file:

```
    // Anything not listed above is denied. Adding a collection now means
    // deliberately deciding who can read it.
    match /{document=**} {
```

It uses the `isSuperAdmin()`, `role()` and `profile()` helpers already at the
top of the file.

## Rules

```
    // ---- billing ---------------------------------------------------------
    // Super Admin: reads and writes all billing data.
    // Clinic admin: reads their OWN clinic's settings and issued invoices,
    //               never drafts, never another clinic's, never writes.
    // Everyone else: no access at all.

    function isOwnClinicAdmin(clinicId) {
      return role() == "admin"
        && string(profile().get("clinicId", "")) == clinicId;
    }

    // Per-clinic billing settings.
    match /clinics/{clinicId}/billing/{docId} {
      allow read: if isSuperAdmin() || isOwnClinicAdmin(clinicId);
      allow write: if isSuperAdmin();
    }

    // Super Admin overview reads every clinic's settings in one query.
    match /{path=**}/billing/{docId} {
      allow read: if isSuperAdmin();
    }

    // Invoices.
    match /clinics/{clinicId}/invoices/{invoiceId} {
      function changedOnly(fields) {
        return request.resource.data.diff(resource.data)
          .affectedKeys().hasOnly(fields);
      }

      allow read: if isSuperAdmin()
        || (isOwnClinicAdmin(clinicId)
            && resource.data.status in ["issued", "paid", "void"]);

      // New invoices are always drafts with no number.
      allow create: if isSuperAdmin()
        && request.resource.data.status == "draft"
        && request.resource.data.invoiceNumber == null
        && request.resource.data.clinicId == int(clinicId);

      // Only a draft can be deleted (it has no number yet).
      allow delete: if isSuperAdmin() && resource.data.status == "draft";

      // An invoice never changes except by these three steps.
      allow update: if isSuperAdmin() && (
        // draft -> issued: number, dates and who issued it, nothing else
        (resource.data.status == "draft"
          && request.resource.data.status == "issued"
          && request.resource.data.invoiceNumber is string
          && changedOnly(["status", "invoiceNumber", "issueDate",
                          "dueDate", "issuedAt", "issuedBy"]))
        ||
        // issued -> paid: payment date and EFT reference only
        (resource.data.status == "issued"
          && request.resource.data.status == "paid"
          && request.resource.data.paymentReference is string
          && request.resource.data.paymentReference.size() > 0
          && changedOnly(["status", "paidDate", "paymentReference"]))
        ||
        // issued or paid -> void: a reason is required
        (resource.data.status in ["issued", "paid"]
          && request.resource.data.status == "void"
          && request.resource.data.voidReason is string
          && request.resource.data.voidReason.size() >= 5
          && changedOnly(["status", "voidReason", "voidedAt", "voidedBy"]))
      );
    }

    // Super Admin overview reads every clinic's invoices in one query.
    match /{path=**}/invoices/{invoiceId} {
      allow read: if isSuperAdmin();
    }

    // Which invoice holds each clinic's month (stops a second invoice).
    match /clinics/{clinicId}/billingMonths/{month} {
      allow read, write: if isSuperAdmin();
    }

    // Invoice number counter: Super Admin only, and it can only go up by one.
    match /billingCounters/{year} {
      allow read: if isSuperAdmin();
      allow create: if isSuperAdmin() && request.resource.data.last == 1;
      allow update: if isSuperAdmin()
        && request.resource.data.last == resource.data.last + 1;
    }
```

## What these rules do NOT guarantee

- They don't prove that the number on an invoice is the one the counter just
  gave out. The app does both in one transaction, but a Super Admin writing
  to the database by hand could still set a wrong number.
- These rules have not been run. There is no Firestore emulator in this
  project. They will be tested for real in Phase 5, once you've applied them.

## Search indexes Firestore will ask for

The first time each of these queries runs, Firestore refuses it and prints a
link in the browser console (press F12, then open the Console tab). Click the
link, then click Create index. Each index takes a few minutes to build.

| Where it's used | Collection | Fields |
|---|---|---|
| Active-patient count | `patientDispensing` | clinicId, createdAt |
| Active-patient count | `appointments` | clinicId, appointDateTime |
| Active-patient count | `queue` | facilityId, joinedAt |
| Clinic admin invoice list | `invoices` (collection) | status, billingMonth (descending) |
| Super Admin month view | `invoices` (collection group) | billingMonth |

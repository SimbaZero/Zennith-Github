# Guide — Adding New Collections ("Tables") and Linked Records

How to extend the Zennith Firestore database: create a new collection, link it to
existing ones, write records safely, and surface them in the UI.

> **File names.** In this repo the Firestore data layer is
> [`src/lib/clinic-data.ts`](../src/lib/clinic-data.ts). (`src/lib/clinic.ts` is a
> different module — the multi-clinic/facility selector.) Put all new queries and
> writes in `clinic-data.ts`.

---

## 1. Mental model: Firestore is not SQL

| SQL | Firestore | In this project |
|---|---|---|
| Table | Collection | `patients`, `appointments`, `inventory` |
| Row | Document | `patients/Pat-3` |
| Primary key | Document ID | `"Pat-3"`, `"7"` |
| Foreign key | A field holding another doc's ID | `appointments.patientId = "Pat-3"` |
| `JOIN` | **Nothing — you fetch the other doc yourself in code** | `getDoc(doc(db,"patients",pid))` |
| `AUTO_INCREMENT` | **Nothing — you allocate IDs yourself** | `counters/registration` transaction |

Three consequences that drive everything below:

1. **There are no joins.** A "joined" view is you reading collection A, then
   fetching the related docs from B. Do it in one batched `Promise.all`, not a
   loop of awaits.
2. **There is no referential integrity.** Nothing stops you writing an
   appointment whose `patientId` doesn't exist. **Validate before you write.**
3. **There is no schema.** Two documents in the same collection can have
   different fields. Your TypeScript interface is the only contract — keep it
   honest.

---

## 2. Conventions already in use — follow them

**Document IDs**

- Human-facing entities use a prefixed ID: `Pat-3`, `Doc-2`, `Nur-1`, `Pharm-2`, `Rec-1`.
- Everything else uses a plain number as a *string*: `appointments/7`, `medicalRecords/3`.
- Login profiles are keyed by **Firebase Auth UID**: `profiles/{uid}` — never a number.

**Field naming** — the imported dataset uses `camelCase` with an explicit id field
repeated inside the doc (`patients/Pat-3` contains `patientId: "Pat-3"`). Keep that
pattern so existing joins keep working.

**Watch out:** the imported data stores some numbers as **strings**
(`inventory.quantity` is `"500"`). Always normalise on read — `Number(x.quantity ?? 0)` —
and write real numbers back.

---

## 3. The five steps

### Step 1 — Design the document and its links

Decide, on paper, before writing code:

- What does one record represent?
- Which existing collections does it point at, and by which ID?
- Which ID strategy: prefixed (`Rx-12`), numeric, or auto-ID (`addDoc`)?

Use `addDoc` (auto-ID) when the record is a log/event nobody references by ID —
that's how `distributions` works. Use an allocated ID when other records must
point back at it.

### Step 2 — Allocate IDs safely (only if you need sequential IDs)

Never do `count + 1` — two users signing up at once would collide. Use the
existing `counters` document inside a transaction, exactly like `registerPatient`:

```ts
const ids = await runTransaction(db, async (tx) => {
  const ref = doc(db, "counters", "registration");
  const snap = await tx.get(ref);
  const cur = snap.exists()
    ? (snap.data() as { patientNo: number; userNo: number; recordNo: number })
    : { patientNo: 9000, userNo: 90000, recordNo: 9000 };
  const next = { patientNo: cur.patientNo + 1, userNo: cur.userNo + 1, recordNo: cur.recordNo + 1 };
  tx.set(ref, next);
  return next;
});
```

Bases start high (9000/90000) so generated IDs can never collide with the
imported dataset. Add a new counter field for a new collection.

### Step 3 — Write the create function (validate → allocate → write)

Rules:

- **Validate every foreign key** with a `getDoc` before writing.
- Use `runTransaction` when a write depends on reading current state
  (stock levels, counters). Use `Promise.all` for independent writes.
- Use `null`, not `undefined`, for "no value" — Firestore rejects `undefined`.

### Step 4 — Write the read function (query + join)

Firestore in this project deliberately avoids composite indexes: use **one**
equality filter, or **one** `orderBy`, and filter the rest in JS. Batch the joins:

```ts
const names = await Promise.all(ids.map((id) => getDoc(doc(db, "patients", id))));
```

### Step 5 — Wire it to a page with TanStack Query

Reads use `useQuery`; writes use `useMutation` + `invalidateQueries` so the UI
refreshes. Never call the data layer directly in a component body.

---

## 4. Worked example — a `prescriptions` collection

A prescription links **three** existing collections: a patient, the doctor who
prescribed it, and an inventory medication.

### 4.1 The shape

```
prescriptions/Rx-1
  prescriptionId: "Rx-1"
  patientId:      "Pat-3"      -> patients/Pat-3
  clinician:      "Doc-2"      -> doctors/Doc-2
  inventId:       7            -> inventory (field inventId)
  medName:        "Metformin 850mg"
  dosage:         "850mg twice daily"
  quantity:       60
  status:         "Active"     // Active | Completed | Cancelled
  issuedAt:       "2026-07-26T09:00:00.000Z"
```

### 4.2 Add the counter field

In `scripts/reset-to-demo.mjs`, extend the counters seed so prescriptions get
their own sequence:

```js
{ patientNo: 9000, userNo: 90000, recordNo: 9000, prescriptionNo: 0 }
```

### 4.3 The data layer — add to `src/lib/clinic-data.ts`

```ts
export interface Prescription {
  id: string;
  prescriptionId: string;
  patientId: string;
  patientName: string;   // joined from patients -> users
  clinician: string;
  medName: string;
  dosage: string;
  quantity: number;
  status: "Active" | "Completed" | "Cancelled";
  issuedAt: string;
}

/** Creates a prescription after validating every link it depends on. */
export async function createPrescription(input: {
  patientId: string;
  clinician: string;
  inventId: number;
  dosage: string;
  quantity: number;
}): Promise<{ ok: boolean; prescriptionId?: string; error?: string }> {
  // 1 — validate foreign keys (Firestore will NOT do this for you)
  const [patientSnap, clinicianSnap] = await Promise.all([
    getDoc(doc(db, "patients", input.patientId)),
    getDoc(doc(db, /^doc/i.test(input.clinician) ? "doctors" : "nurses", input.clinician)),
  ]);
  if (!patientSnap.exists()) return { ok: false, error: `Patient "${input.patientId}" not found` };
  if (!clinicianSnap.exists()) return { ok: false, error: `Clinician "${input.clinician}" not found` };

  const invSnap = await getDocs(
    query(collection(db, "inventory"), where("inventId", "==", input.inventId)),
  );
  if (invSnap.empty) return { ok: false, error: "Medication not found" };
  const medName = invSnap.docs[0].data().medName ?? "";

  // 2 — allocate an ID race-safely
  const no = await runTransaction(db, async (tx) => {
    const ref = doc(db, "counters", "registration");
    const snap = await tx.get(ref);
    const cur = snap.exists() ? snap.data() : {};
    const next = Number(cur.prescriptionNo ?? 0) + 1;
    tx.set(ref, { ...cur, prescriptionNo: next }, { merge: true });
    return next;
  });

  // 3 — write the document
  const prescriptionId = `Rx-${no}`;
  await setDoc(doc(db, "prescriptions", prescriptionId), {
    prescriptionId,
    patientId: input.patientId,
    clinician: input.clinician,
    inventId: input.inventId,
    medName,
    dosage: input.dosage,
    quantity: input.quantity,
    status: "Active",
    issuedAt: new Date().toISOString(),
  });
  return { ok: true, prescriptionId };
}

/** All prescriptions for one patient, with the patient's name joined in. */
export async function fetchPrescriptionsForPatient(patientId: string): Promise<Prescription[]> {
  const snap = await getDocs(
    query(collection(db, "prescriptions"), where("patientId", "==", patientId)),
  );
  const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));

  // join: patients/{id} -> users/{userId}  (batched, not a serial loop)
  const names = await patientNames(rows.map((r) => r.patientId));
  return rows
    .map((r) => ({ ...r, patientName: names.get(r.patientId)?.name ?? r.patientId }))
    .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
}
```

`patientNames()` already exists in `clinic-data.ts` — reuse it rather than
writing another join helper.

### 4.4 The UI

```tsx
function Prescriptions({ patientId }: { patientId: string }) {
  const queryClient = useQueryClient();

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["prescriptions", patientId],
    queryFn: () => fetchPrescriptionsForPatient(patientId),
  });

  const create = useMutation({
    mutationFn: () =>
      createPrescription({
        patientId, clinician: "Doc-2", inventId: 7,
        dosage: "850mg twice daily", quantity: 60,
      }),
    onSuccess: (res) => {
      if (!res.ok) return toast.error(res.error ?? "Could not create prescription");
      toast.success(`Prescription ${res.prescriptionId} issued`);
      queryClient.invalidateQueries({ queryKey: ["prescriptions", patientId] });
    },
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  return (
    <div>
      {rows.map((r) => (
        <div key={r.id}>{r.medName} · {r.dosage} · {r.status}</div>
      ))}
      <button disabled={create.isPending} onClick={() => create.mutate()}>
        {create.isPending ? "Issuing…" : "Issue prescription"}
      </button>
    </div>
  );
}
```

### 4.5 Security rules

A new collection is **denied by default** once you move past the permissive dev
rules. Add it in the Firebase console → Firestore → Rules:

```
match /prescriptions/{id} {
  allow read:  if request.auth != null;
  allow write: if role() in ['doctor', 'nurse'];
}
```

(`role()` is the helper defined in [FIREBASE.md](FIREBASE.md).)

### 4.6 Seed some demo rows

Add to `scripts/generate-demo-data.mjs` so the new screen isn't empty:

```js
for (let i = 1; i <= 10; i++) {
  const m = pick(inv);
  await put("prescriptions", `Rx-${i}`, {
    prescriptionId: `Rx-${i}`,
    patientId: `Pat-${1 + Math.floor(rnd() * 10)}`,
    clinician: `Doc-${1 + Math.floor(rnd() * 10)}`,
    inventId: m.inventId, medName: m.medName,
    dosage: pick(["Once daily", "Twice daily", "Every 8 hours"]),
    quantity: 30 * (1 + Math.floor(rnd() * 3)),
    status: pick(["Active", "Active", "Completed"]),
    issuedAt: dt(-Math.floor(rnd() * 60), hhmm()),
  });
}
```

Then `node scripts/generate-demo-data.mjs` (additive — it won't wipe anything).

---

## 5. Linking patterns cheat-sheet

**One-to-many** (one patient → many prescriptions): put the "one" side's ID on
the "many" side (`prescriptions.patientId`), then
`where("patientId", "==", pid)`.

**Many-to-many** (nurses ↔ medications): create a join collection where each
document is one pairing — that's exactly what `distributions` is
(`inventId` + `nurseName` + `unitsGiven`).

**Linking to a login** — never store the Auth UID on domain records. Go through
the bridge: `profiles/{uid}.legacyUserId` → `users.userId` → `doctors`/`patients`.
`resolveClinicianId()` in `clinic-data.ts` is the working example.

**Deleting** — there are no cascades. Deleting `patients/Pat-3` leaves its
appointments orphaned. Either delete dependants explicitly, or prefer a
`status: "Cancelled"` field (safer, keeps history).

---

## 6. Checklist for any new collection

- [ ] Document shape + TypeScript interface defined
- [ ] ID strategy chosen (auto-ID for logs, counter for referenced entities)
- [ ] Every foreign key validated with `getDoc` before writing
- [ ] Transaction used where the write depends on current state
- [ ] Read function batches joins with `Promise.all`
- [ ] Query uses a single equality filter / `orderBy` (no composite index needed)
- [ ] Page uses `useQuery` / `useMutation` + `invalidateQueries`
- [ ] Security rule added for the new collection
- [ ] Seed rows added to `scripts/generate-demo-data.mjs`
- [ ] `npx tsc --noEmit` clean, then verified in the running app

---

## 7. Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| `Unsupported field value: undefined` | Wrote `undefined` | Use `null`, or omit with `...(x ? { x } : {})` |
| `The query requires an index` | Two filters, or filter + different `orderBy` | Use one filter, sort/filter the rest in JS |
| Arithmetic gives `"50030"` | Imported field is a string | `Number(x.quantity ?? 0)` on read |
| UI doesn't refresh after save | Query cache is stale | `queryClient.invalidateQueries({ queryKey: [...] })` |
| `Missing or insufficient permissions` | No rule for the new collection | Add a `match` block for it |
| Two records got the same ID | Counted docs instead of allocating | Use the `counters` transaction |
| Name shows as `Pat-7` instead of a person | Join not applied | Run it through `patientNames()` / `attachPatientNames()` |

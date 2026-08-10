import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AppShell, StatusBadge } from "@/components/AppShell";
import {
  useCurrentNurse,
  useNurseDashboard,
  fetchHandoverEntries,
  addHandoverEntry,
  removeHandoverEntry,
  fetchShiftStatus,
  finalizeShift,
  summarizeShift,
  type HandoverEntry,
} from "@/lib/nurse-service";
import {
  ScanLine,
  CalendarPlus,
  Users,
  Syringe,
  Wifi,
  WifiOff,
  Trash2,
  Lock,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useOnline } from "@/lib/offline"; // unchanged — browser online/offline event, unrelated to this migration
import { toast } from "sonner";

export const Route = createFileRoute("/nurse/")({ component: NurseDashboard });

function NurseDashboard() {
  const navigate = useNavigate();
  const { nurse } = useCurrentNurse();
  const { data, loading, error } = useNurseDashboard(); // was useQuery(fetchDoctorDashboard) — now a live hook, no manual refetch // was useQuery(fetchDoctorDashboard) — now a live hook, no manual refetch

  const today = new Date().toISOString().slice(0, 10);
  const scheduleLabel =
    !data || data.scheduleDate === today
      ? "Today's Appointments"
      : `Appointments · ${data.scheduleDate}`;

  return (
    <AppShell
      role="nurse"
      title="Nurse Dashboard"
      showBack={false}
      staffNameOverride={nurse?.fullName}
      clinicNameOverride={nurse?.clinicName}
    >
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Stat
          label="APPOINTMENTS"
          value={data ? String(data.stats.dayTotal) : "—"}
          sub={data ? `${data.stats.dayCompleted} completed` : "loading…"}
        />
        <Stat
          label="PATIENTS THIS WEEK"
          value={data ? String(data.stats.weekPatients) : "—"}
          sub="Unique patients, 7 days"
        />
        <Stat
          label="UPCOMING"
          value={data ? String(data.stats.upcoming) : "—"}
          sub="Future appointments"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-xl border p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">{scheduleLabel}</h3>
            <button
              onClick={() => navigate({ to: "/nurse/appointments" })}
              className="text-sm border px-3 py-1.5 rounded-md hover:bg-secondary"
            >
              Schedule New
            </button>
          </div>
          <div className="space-y-2">
            {loading && (
              <p className="text-sm text-muted-foreground py-6 text-center">
                Loading appointments…
              </p>
            )}
            {error && (
              <p className="text-sm text-destructive py-6 text-center">
                Could not load appointments.
              </p>
            )}
            {data?.schedule.map((a) => (
              // was key={a.id} — DoctorAppointment (reused type) uses docId, not id
              <div
                key={a.docId}
                className="flex items-center gap-4 p-3 hover:bg-secondary/50 rounded-md"
              >
                <div className="font-mono text-sm font-semibold w-12">
                  {a.time}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">
                    {a.patientName}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {[a.patientId, a.condition, a.type]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                <StatusBadge status={a.status} />
              </div>
            ))}
            {data && data.schedule.length === 0 && (
              // was data.doctorId — NurseDashboardData uses nurseId
              <p className="text-sm text-muted-foreground py-6 text-center">
                No appointments found for {data.nurseId}.
              </p>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border p-5">
          <h3 className="font-semibold mb-4">Quick Actions</h3>
          <div className="space-y-2">
            <Link
              to="/nurse/digitize"
              className="flex items-center justify-center gap-2 bg-[oklch(0.18_0.06_260)] text-white py-2.5 rounded-md text-sm font-medium hover:bg-[oklch(0.25_0.08_260)]"
            >
              <ScanLine size={16} /> Digitize File
            </Link>
            <Link
              to="/nurse/appointments"
              className="flex items-center justify-center gap-2 border py-2.5 rounded-md text-sm hover:bg-secondary"
            >
              <CalendarPlus size={16} /> Schedule Appointment
            </Link>
            <Link
              to="/nurse/patients"
              className="flex items-center justify-center gap-2 border py-2.5 rounded-md text-sm hover:bg-secondary"
            >
              <Users size={16} /> View Patients
            </Link>
            <Link
              to="/nurse/patients"
              className="flex items-center justify-center gap-2 border py-2.5 rounded-md text-sm hover:bg-secondary"
            >
              <Syringe size={16} /> Dispense Medication
            </Link>
          </div>
          <div className="mt-5 pt-5 border-t">
            <p className="text-[11px] tracking-wider text-muted-foreground mb-2">
              THIS WEEK
            </p>
            <Row
              label="Patients seen"
              value={data ? String(data.stats.weekPatients) : "—"}
            />
            <Row
              label="Appointments"
              value={data ? String(data.stats.dayTotal) : "—"}
            />
            <Row label="Clinician" value={data?.nurseId ?? "—"} />
          </div>
        </div>
      </div>

      <HandoverLog />
    </AppShell>
  );
}

function HandoverLog() {
  const { nurse } = useCurrentNurse();
  const online = useOnline();
  const [shift, setShift] = useState<"Day" | "Night">("Day");
  const [patient, setPatient] = useState("");
  const [note, setNote] = useState("");
  const [entries, setEntries] = useState<HandoverEntry[]>([]);
  const [finalized, setFinalized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // NOTE: this now shows only the SIGNED-IN nurse's own entries, not a
  // team-wide log — the real handoverEntries schema has no clinicId field
  // to scope a shared view by, only nurseId. If you want a shared team log
  // later, that needs a schema change (add clinicId to the entry), not a
  // frontend one.
  const refresh = async () => {
    if (!nurse) return;
    setLoading(true);
    const [entriesResult, statusResult] = await Promise.all([
      fetchHandoverEntries(nurse.nurseId, shift),
      fetchShiftStatus(nurse.nurseId, shift),
    ]);
    setEntries(entriesResult);
    setFinalized(!!statusResult?.finalized);
    setLoading(false);
  };

  useEffect(() => {
    refresh();
    // Simple polling instead of onSnapshot, matching this file's existing
    // plain-async-function style rather than mixing in a live listener.
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nurse?.nurseId, shift]);

  const summary = summarizeShift(entries);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nurse) return;
    if (!note.trim()) return toast.error("Add a handover note first");
    if (finalized) return toast.error("This shift is already finalized");
    setSubmitting(true);
    try {
      await addHandoverEntry({
        nurseId: nurse.nurseId,
        patientId: patient.trim() || undefined,
        note: note.trim(),
      });
      toast.success("Handover logged");
      setPatient("");
      setNote("");
      await refresh();
    } catch {
      toast.error("Could not save handover note");
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (id: string) => {
    await removeHandoverEntry(id);
    await refresh();
  };

  const handleFinalize = async () => {
    if (!nurse) return;
    if (entries.length === 0) return toast.error("No entries to finalize");
    try {
      // clinicId comes off the nurse's own record — confirmed real field.
      await finalizeShift({
        nurseId: nurse.nurseId,
        clinicId: nurse.clinicId ?? 0,
        shift,
      });
      toast.success(`${shift} shift finalized`);
      await refresh();
    } catch {
      toast.error("Could not finalize shift");
    }
  };

  return (
    <div className="mt-6 bg-white rounded-xl border p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h3 className="font-semibold">Shift Handover Log</h3>
          <p className="text-xs text-muted-foreground">
            {summary.count} entries · {summary.patients} patients this{" "}
            {shift.toLowerCase()} shift
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border ${online ? "bg-[oklch(0.97_0.06_160)] text-[oklch(0.4_0.15_160)]" : "bg-[oklch(0.97_0.05_60)] text-[oklch(0.45_0.17_60)]"}`}
          >
            {online ? <Wifi size={12} /> : <WifiOff size={12} />}
            {online ? "Online" : "Offline"}
          </span>
          <div className="flex rounded-md border overflow-hidden text-xs">
            {(["Day", "Night"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setShift(s)}
                className={`px-3 py-1.5 ${shift === s ? "bg-[oklch(0.18_0.06_260)] text-white" : "hover:bg-secondary"}`}
              >
                {s}
              </button>
            ))}
          </div>
          <button
            onClick={handleFinalize}
            disabled={finalized || entries.length === 0}
            className="flex items-center gap-1.5 text-xs border px-3 py-1.5 rounded-md hover:bg-secondary disabled:opacity-50"
          >
            <Lock size={12} /> {finalized ? "Finalized" : "Finalize Shift"}
          </button>
        </div>
      </div>

      <form
        onSubmit={submit}
        className="grid grid-cols-1 md:grid-cols-[1fr_2fr_auto] gap-2 mb-4"
      >
        <input
          value={patient}
          onChange={(e) => setPatient(e.target.value)}
          placeholder="Patient ID (optional)"
          disabled={finalized}
          className="px-3 py-2 border rounded-md text-sm outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)] disabled:opacity-50"
        />
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Handover note (vitals, meds due, follow-up…)"
          disabled={finalized}
          className="px-3 py-2 border rounded-md text-sm outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)] disabled:opacity-50"
        />
        <button
          disabled={submitting || finalized}
          className="bg-[oklch(0.18_0.06_260)] text-white px-4 py-2 rounded-md text-sm hover:bg-[oklch(0.25_0.08_260)] disabled:opacity-50"
        >
          {submitting ? "Saving…" : "Log entry"}
        </button>
      </form>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No handover entries yet.
        </p>
      ) : (
        <ul className="divide-y">
          {entries.slice(0, 8).map((e) => (
            <li key={e.id} className="py-2.5 flex items-start gap-3 text-sm">
              <span className="font-mono text-xs text-muted-foreground w-16 shrink-0 mt-0.5">
                {e.createdAt?.toDate().toLocaleTimeString("en-ZA", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
              <div className="flex-1 min-w-0">
                {/* was e.nurse (a plain name string) — real schema only
                    stores nurseId, no denormalized name, so showing the ID */}
                <div className="font-medium">
                  {e.patientId ?? "General"} ·{" "}
                  <span className="text-muted-foreground font-normal">
                    {e.nurseId}
                  </span>
                </div>
                <div className="text-muted-foreground">{e.note}</div>
              </div>
              {!finalized && (
                <button
                  onClick={() => remove(e.id)}
                  className="text-muted-foreground hover:text-[oklch(0.55_0.2_25)]"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="bg-white rounded-xl border p-5">
      <p className="text-[11px] tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="text-3xl font-bold mt-1">{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{sub}</p>
    </div>
  );
}
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}

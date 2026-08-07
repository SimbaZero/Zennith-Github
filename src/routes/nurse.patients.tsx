import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { usePatientDirectory, useFindPatientById, useCurrentNurse, fetchAdherenceForToday, setAdherence, todayIso } from "@/lib/nurse-service";
import { useEffect, useState } from "react";
import { useOnline } from "@/lib/offline"; // unchanged
import { Wifi, WifiOff, CheckCircle2, Circle } from "lucide-react";

export const Route = createFileRoute("/nurse/patients")({ component: NursePatients });

const MEDS_BY_CONDITION: Record<string, string[]> = {
  HIV: ["TLD", "Efavirenz"],
  AIDS: ["TLD", "Cotrimoxazole"],
  TB: ["Rifafour", "Isoniazid"],
  Hypertension: ["Amlodipine", "Enalapril"],
  "Diabetes Type 2": ["Metformin", "Glimepiride"],
  Cardiac: ["Aspirin", "Atorvastatin"],
  "Chronic Kidney Disease": ["Furosemide", "Erythropoietin"],
};

// Was useAdherence(pid) from "@/lib/adherence" (a localStorage-backed
// hook). fetchAdherenceForToday/setAdherence are plain async Firestore
// functions now, not a hook, so this component does its own small
// load/refresh cycle instead.
function AdherenceCell({ pid, condition, nurseId }: { pid: string; condition: string; nurseId: string | undefined }) {
  const [forToday, setForToday] = useState<Record<string, boolean>>({});
  const meds = MEDS_BY_CONDITION[condition] ?? [];

  useEffect(() => {
    if (meds.length === 0) return;
    fetchAdherenceForToday(pid).then(setForToday);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid]);

  if (meds.length === 0) return <span className="text-xs text-muted-foreground">—</span>;

  const toggle = async (med: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!nurseId) return;
    const next = !forToday[med];
    setForToday((prev) => ({ ...prev, [med]: next })); // optimistic
    try {
      await setAdherence(pid, med, next, nurseId);
    } catch {
      setForToday((prev) => ({ ...prev, [med]: !next })); // revert on failure
    }
  };

  return (
    <div className="flex flex-wrap gap-1.5">
      {meds.map((m) => {
        const taken = !!forToday[m];
        return (
          <button
            key={m}
            onClick={(e) => toggle(m, e)}
            title={`${m} — ${todayIso()}`}
            className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border ${taken ? "bg-[oklch(0.95_0.08_160)] border-[oklch(0.7_0.15_160)] text-[oklch(0.35_0.15_160)]" : "hover:bg-secondary text-muted-foreground"}`}
          >
            {taken ? <CheckCircle2 size={11} /> : <Circle size={11} />}
            {m}
          </button>
        );
      })}
    </div>
  );
}

function NursePatients() {
  const online = useOnline();
  return (
    <AppShell role="nurse" title="Patient Files">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border ${online ? "bg-[oklch(0.97_0.06_160)] text-[oklch(0.4_0.15_160)]" : "bg-[oklch(0.97_0.05_60)] text-[oklch(0.45_0.17_60)]"}`}>
          {online ? <Wifi size={12} /> : <WifiOff size={12} />}
          {/* was "Offline — adherence saved locally" — no longer true, a
              write while offline now fails rather than queueing locally,
              unless Firestore's own offline persistence is enabled */}
          {online ? "Online" : "Offline"}
        </span>
        <span className="text-xs text-muted-foreground">Tap a medication badge to log today's dose (chronic-care).</span>
      </div>
      <PatientFilesTable recordBase="/nurse/patient-record" showAdherence />
    </AppShell>
  );
}

export function PatientFilesTable({ recordBase = "/nurse/patient-record", showAdherence = false }: { recordBase?: string; showAdherence?: boolean }) {
  const [q, setQ] = useState("");
  const { nurse } = useCurrentNurse();

  // was useQuery(fetchPatientPage) — now a live hook, updates automatically
  const { patients: page, loading: pageLoading } = usePatientDirectory(30);

  const idQuery = /^pat-\d+$/i.test(q.trim()) ? `Pat-${q.trim().match(/\d+/)![0]}` : null;
  const { patient: found, loading: findLoading } = useFindPatientById(idQuery);

  const loading = idQuery ? findLoading : pageLoading;
  const filtered = idQuery
    ? (found ? [found] : [])
    : page.filter(
        (p) => p.name.toLowerCase().includes(q.toLowerCase()) || p.patientId.toLowerCase().includes(q.toLowerCase()),
      );

  return (
    <div className="bg-white rounded-xl border overflow-hidden">
      <div className="flex items-center justify-between p-5 border-b">
        <div>
          <h3 className="font-semibold">Patient Files</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {pageLoading ? "Loading patients…" : "Browsing first 30 — search a Patient ID (e.g. Pat-828) for anyone else"}
          </p>
        </div>
        <input
          placeholder="Search name or Pat-###…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="border rounded-md px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)] w-64"
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-muted-foreground text-left">
              <th className="px-5 py-3 font-medium">Patient ID</th>
              <th className="px-5 py-3 font-medium">Name</th>
              <th className="px-5 py-3 font-medium">Condition</th>
              {showAdherence && <th className="px-5 py-3 font-medium">Today's meds</th>}
              <th className="px-5 py-3 font-medium">Last Visit</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.patientId} className="border-t hover:bg-secondary/40">
                <td className="px-5 py-3.5 text-muted-foreground">{p.patientId}</td>
                <td className="px-5 py-3.5 font-medium">{p.name}</td>
                <td className="px-5 py-3.5">{p.condition}</td>
                {showAdherence && (
                  <td className="px-5 py-3.5">
                    <AdherenceCell pid={p.patientId} condition={p.condition} nurseId={nurse?.nurseId} />
                  </td>
                )}
                <td className="px-5 py-3.5 text-muted-foreground">{p.lastVisit}</td>
                <td className="px-5 py-3.5 text-right">
                  <Link
                    to={`${recordBase}/${p.patientId}` as any}
                    className="border px-3 py-1 rounded-md text-xs hover:bg-secondary"
                  >
                    View
                  </Link>
                </td>
              </tr>
            ))}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={showAdherence ? 6 : 5} className="px-5 py-8 text-center text-muted-foreground">
                  {idQuery ? `No patient with ID "${idQuery}".` : "No matching patients in the loaded page — try an exact Pat-### ID."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

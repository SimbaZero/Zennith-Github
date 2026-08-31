import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import {
  MessageCircle,
  Plus,
  ArrowRight,
  CheckCircle,
  ClipboardList,
} from "lucide-react";
import { useEffect, useRef, useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { useNow } from "@/lib/store";
import type { QueueEntry, TriageLevel } from "@/lib/clinic-data";
import { resolveCurrentReceptionist } from "@/lib/clinic-data";
import { usePatientDirectory } from "@/lib/doctor-service";

export const Route = createFileRoute("/receptionist/queue")({
  component: QueuePage,
  ssr: false,
});

const TRIAGE_COLORS: Record<TriageLevel, string> = {
  red: "bg-red-600 text-white",
  orange: "bg-orange-500 text-white",
  yellow: "bg-yellow-400 text-black",
  green: "bg-green-500 text-white",
};

const TRIAGE_LABELS: Record<TriageLevel, string> = {
  red: "Critical — Immediate",
  orange: "Emergent — 10 min",
  yellow: "Urgent — 30 min",
  green: "Less Urgent — 60 min",
};

const TRIAGE_SHORT: Record<TriageLevel, string> = {
  red: "CRITICAL",
  orange: "EMERGENT",
  yellow: "URGENT",
  green: "ROUTINE",
};

const STATUS_TEXT: Record<string, string> = {
  waiting: "Waiting",
  called: "Called — heading in",
  "in-room": "With clinician",
  handoff: "Being handed over",
  done: "Finished",
};

const STATUS_STYLE: Record<string, string> = {
  waiting: "bg-slate-100 text-slate-700 border-slate-200",
  called: "bg-blue-100 text-blue-800 border-blue-200",
  "in-room": "bg-emerald-100 text-emerald-800 border-emerald-200",
  handoff: "bg-purple-100 text-purple-800 border-purple-200",
  done: "bg-slate-100 text-slate-500 border-slate-200",
};

const TRIAGE_MAX_WAIT_MINUTES: Record<TriageLevel, number> = {
  red: 0,
  orange: 10,
  yellow: 30,
  green: 60,
};

const BTN_SECONDARY =
  "text-xs font-medium border px-3 py-1.5 rounded-md hover:bg-secondary";

// Guided triage. Reception is not clinically trained, so they should not be
// choosing "Critical" from a dropdown — they answer observable yes/no
// questions and the level is computed. Modelled on the emergency
// discriminators used in the South African Triage Scale (SATS): things a
// non-clinician can see or be told, not vital signs or clinical judgement.
//
// TODO(db): the selected flags are appended to the visit reason so there's a
// record of WHY a level was assigned. A dedicated field on the queue entry
// would be better — needs a schema change.
const TRIAGE_QUESTIONS: {
  id: string;
  label: string;
  level: TriageLevel;
}[] = [
  // Any one of these = CRITICAL
  {
    id: "unresponsive",
    label: "Unresponsive, or not breathing normally",
    level: "red",
  },
  { id: "bleeding", label: "Heavy bleeding that won't stop", level: "red" },
  { id: "seizure", label: "Having a seizure right now", level: "red" },
  {
    id: "breathing",
    label: "Struggling badly to breathe / can't speak in full sentences",
    level: "red",
  },
  // Any one of these = EMERGENT
  { id: "chest", label: "Chest pain or pressure", level: "orange" },
  {
    id: "stroke",
    label: "Face drooping, weakness on one side, or slurred speech",
    level: "orange",
  },
  {
    id: "pregnancy",
    label: "Pregnant with bleeding, severe pain, or in labour",
    level: "orange",
  },
  {
    id: "confused",
    label: "Confused, drowsy, or not making sense",
    level: "orange",
  },
  {
    id: "severePain",
    label: "Severe pain (can't sit still or speak normally)",
    level: "orange",
  },
  {
    id: "injury",
    label: "Serious recent injury, burn, or head knock",
    level: "orange",
  },
  // Any one of these = URGENT
  { id: "fever", label: "Fever and feeling very unwell", level: "yellow" },
  {
    id: "vomiting",
    label: "Vomiting repeatedly or can't keep fluids down",
    level: "yellow",
  },
  {
    id: "wound",
    label: "Wound needing attention (not heavy bleeding)",
    level: "yellow",
  },
  { id: "moderatePain", label: "Moderate pain", level: "yellow" },
];

const TRIAGE_RANK: Record<TriageLevel, number> = {
  green: 0,
  yellow: 1,
  orange: 2,
  red: 3,
};

/** Highest severity among the ticked answers; nothing ticked = routine. */
function computeTriage(flags: Set<string>): TriageLevel {
  let level: TriageLevel = "green";
  for (const q of TRIAGE_QUESTIONS) {
    if (flags.has(q.id) && TRIAGE_RANK[q.level] > TRIAGE_RANK[level]) {
      level = q.level;
    }
  }
  return level;
}

type LogEntry = { ts: string; msg: string; type: "info" | "warn" | "critical" };

let clinicData: typeof import("@/lib/clinic-data") | null = null;
async function getClinicData() {
  if (!clinicData) clinicData = await import("@/lib/clinic-data");
  return clinicData;
}

function QueuePage() {
  const now = useNow(60_000);

  const { data: receptionist } = useQuery({
    queryKey: ["current-receptionist"],
    queryFn: resolveCurrentReceptionist,
  });
  const realFacilityId =
    receptionist?.clinicId != null ? String(receptionist.clinicId) : null;

  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [walkInQuery, setWalkInQuery] = useState("");
  const { patients: clinicPatients } = usePatientDirectory(
    500,
    receptionist?.clinicId ?? undefined,
  );
  const walkInMatches = walkInQuery.trim()
    ? clinicPatients
        .filter(
          (p) =>
            p.name.toLowerCase().includes(walkInQuery.toLowerCase()) ||
            p.patientId.toLowerCase().includes(walkInQuery.toLowerCase()),
        )
        .slice(0, 6)
    : [];
  const [queueError, setQueueError] = useState(false);

  const queuePace = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const doneToday = queue.filter(
      (q) =>
        q.status === "done" && q.calledAt && q.joinedAt.slice(0, 10) === today,
    );
    if (doneToday.length < 2) return null;
    const ratios = doneToday.map((q) => {
      const waited =
        (new Date(q.calledAt!).getTime() - new Date(q.joinedAt).getTime()) /
        60000;
      const target = TRIAGE_MAX_WAIT_MINUTES[q.triage] || 30;
      return waited / target;
    });
    const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    const waits = doneToday.map(
      (q) =>
        (new Date(q.calledAt!).getTime() - new Date(q.joinedAt).getTime()) /
        60000,
    );
    const avgWaitMin = Math.round(
      waits.reduce((a, b) => a + b, 0) / waits.length,
    );

    if (avg < 0.7)
      return {
        label: "Fast today",
        cls: "bg-[oklch(0.94_0.08_160)] text-[oklch(0.3_0.15_160)]",
        avgWaitMin,
        sampleSize: doneToday.length,
      };
    if (avg <= 1.2)
      return {
        label: "Normal pace",
        cls: "bg-[oklch(0.96_0.1_85)] text-[oklch(0.4_0.15_70)]",
        avgWaitMin,
        sampleSize: doneToday.length,
      };
    return {
      label: "Running slow",
      cls: "bg-[oklch(0.94_0.08_25)] text-[oklch(0.4_0.2_25)]",
      avgWaitMin,
      sampleSize: doneToday.length,
    };
  }, [queue]);

  const [clinicReady, setClinicReady] = useState(false);
  const [auditLog, setAuditLog] = useState<LogEntry[]>([]);
  const [auditLogLoading, setAuditLogLoading] = useState(true);
  const [auditLogError, setAuditLogError] = useState(false);

  useEffect(() => {
    getClinicData().then(() => setClinicReady(true));
  }, []);

  useEffect(() => {
    if (!clinicReady) return;
    let unsubscribe: (() => void) | undefined;
    getClinicData().then(({ subscribeQueue }) => {
      unsubscribe = subscribeQueue(
        (rows) => setQueue(rows),
        () => setQueueError(true),
        realFacilityId,
      );
    });
    return () => unsubscribe?.();
  }, [clinicReady, realFacilityId]);

  // Live, so the audit log stays in step with the queue above it instead of
  // only catching up on a manual refresh.
  useEffect(() => {
    if (!clinicReady) return;
    setAuditLogLoading(true);
    setAuditLogError(false);
    let unsubscribe: (() => void) | undefined;
    getClinicData().then(({ subscribeQueueAudit }) => {
      unsubscribe = subscribeQueueAudit(
        (events) => {
          setAuditLog(
            events.map((e) => ({
              ts: e.timestamp?.toDate?.()
                ? e.timestamp.toDate().toISOString()
                : new Date().toISOString(),
              msg: `${e.action.toUpperCase()}: ${e.patientId} — ${e.details}`,
              type:
                e.action === "handoff"
                  ? "warn"
                  : e.triage === "red"
                    ? "critical"
                    : "info",
            })),
          );
          setAuditLogLoading(false);
        },
        () => {
          setAuditLogError(true);
          setAuditLogLoading(false);
        },
        realFacilityId,
        20,
      );
    });
    return () => unsubscribe?.();
  }, [clinicReady, realFacilityId]);

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({
    patientId: "",
    reason: "",
    clinician: "",
  });
  const [triageFlags, setTriageFlags] = useState<Set<string>>(new Set());
  // Reception can raise the level if something worries them, but never lower
  // it — escalating on instinct is safe, downgrading a computed red is not.
  const [escalate, setEscalate] = useState(false);
  const computedTriage = computeTriage(triageFlags);
  const finalTriage: TriageLevel =
    escalate && computedTriage !== "red"
      ? (["green", "yellow", "orange", "red"] as TriageLevel[])[
          TRIAGE_RANK[computedTriage] + 1
        ]
      : computedTriage;
  const [busy, setBusy] = useState(false);
  const [handoffTarget, setHandoffTarget] = useState<string | null>(null);

  const active = queue.filter((q) => q.status !== "done");
  const waiting = active.filter(
    (q) => q.status === "waiting" || q.status === "called",
  );

  const escalatedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!clinicReady) return;
    const stillWaitingIds = new Set(waiting.map((q) => q.id));
    for (const id of escalatedRef.current) {
      if (!stillWaitingIds.has(id)) escalatedRef.current.delete(id);
    }
    waiting.forEach((q) => {
      const waitMin = Math.round(
        (now.getTime() - new Date(q.joinedAt).getTime()) / 60000,
      );
      const maxWait = TRIAGE_MAX_WAIT_MINUTES[q.triage];
      // Same 10-minute grace period the audit flags use — a red target is
      // 0 min, so without it every patient alerts within a minute.
      if (waitMin > maxWait + 10 && q.status === "waiting") {
        if (!escalatedRef.current.has(q.id)) {
          escalatedRef.current.add(q.id);
          toast.error(
            `${q.patientName} (${q.triage.toUpperCase()}) waiting ${waitMin} min`,
            { duration: 10000, id: `escalation-${q.id}` },
          );
          // Real notification, not just a toast — survives navigating away
          // and lands in the bell like everything else.
          if (receptionist?.userId != null) {
            getClinicData().then(({ alertOverdueQueueEntry }) =>
              alertOverdueQueueEntry(q, receptionist.userId!, waitMin).catch(
                (err) => console.error("Overdue alert failed:", err),
              ),
            );
          }
        }
      }
    });
  }, [waiting, now, clinicReady, receptionist?.userId]);

  const addWalkIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.patientId.trim()) return toast.error("Patient ID is required");
    setBusy(true);
    const { addToQueue } = await getClinicData();
    const res = await addToQueue({
      patientId: draft.patientId,
      reason: [
        draft.reason,
        ...TRIAGE_QUESTIONS.filter((q) => triageFlags.has(q.id)).map(
          (q) => q.label,
        ),
      ]
        .filter(Boolean)
        .join(" · "),
      clinician: draft.clinician || undefined,
      triage: finalTriage,
      facilityId: realFacilityId,
    });
    setBusy(false);
    if (!res.ok) return toast.error(res.error ?? "Could not add to queue");
    toast.success(`${draft.patientId} added — ${TRIAGE_LABELS[finalTriage]}`);
    setDraft({ patientId: "", reason: "", clinician: "" });
    setTriageFlags(new Set());
    setEscalate(false);
    setWalkInQuery("");
    setAdding(false);
  };

  const notifyNext = async () => {
    const next = waiting[0];
    if (!next) return toast.info("No patients waiting");
    setBusy(true);
    try {
      const { callPatient } = await getClinicData();
      const { nextAllowed } = await import("@/lib/notifications-queue");
      const deliverAt = nextAllowed(now);
      await callPatient(next, deliverAt);
      const entry: LogEntry = {
        ts: new Date().toISOString(),
        msg: `Called ${next.patientName} (${next.triage.toUpperCase()}) → ${next.clinician || "triage"}`,
        type: "info",
      };
      setAuditLog((l) => [entry, ...l].slice(0, 20));
      toast.success(
        `${next.patientName} called — proceed to ${next.clinician || "triage"}`,
      );
    } catch {
      toast.error("Could not notify patient");
    } finally {
      setBusy(false);
    }
  };

  const handleHandoff = async (entryId: string, targetClinician: string) => {
    if (!targetClinician.trim()) return toast.error("Enter target clinician");
    setBusy(true);
    const { handoffPatient } = await getClinicData();
    const res = await handoffPatient(entryId, targetClinician);
    setHandoffTarget(null);
    setBusy(false);
    if (!res.ok) return toast.error(res.error ?? "Handoff failed");
    toast.success(`Handed off to ${targetClinician}`);
  };

  const handleAcceptHandoff = async (entryId: string, clinicianId: string) => {
    setBusy(true);
    const { acceptHandoff } = await getClinicData();
    const res = await acceptHandoff(entryId, clinicianId);
    setBusy(false);
    if (!res.ok) return toast.error(res.error ?? "Accept failed");
    toast.success("Handoff accepted — patient is now yours");
  };

  const handleSetQueueStatus = async (
    id: string,
    status: QueueEntry["status"],
  ) => {
    const { setQueueStatus } = await getClinicData();
    await setQueueStatus(id, status);
  };

  const handleRemoveFromQueue = async (id: string) => {
    const { removeFromQueue } = await getClinicData();
    await removeFromQueue(id);
  };

  const getWaitTime = (joinedAt: string) =>
    Math.floor((now.getTime() - new Date(joinedAt).getTime()) / 60000);

  const isOverdue = (q: QueueEntry) =>
    getWaitTime(q.joinedAt) > TRIAGE_MAX_WAIT_MINUTES[q.triage];

  if (!clinicReady) {
    return (
      <AppShell
        role="receptionist"
        title="Acute Care Queue"
        clinicNameOverride={receptionist?.clinicName}
        staffNameOverride={receptionist?.name}
      >
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">Loading queue system...</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      role="receptionist"
      title="Acute Care Queue"
      clinicNameOverride={receptionist?.clinicName}
      staffNameOverride={receptionist?.name}
    >
      <div className="bg-white rounded-xl border p-5">
        <div className="flex items-start justify-between mb-3 gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold">Live queue</h3>
              {queuePace && (
                <span
                  className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${queuePace.cls}`}
                >
                  {queuePace.label}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Most urgent first, then longest waiting
            </p>
          </div>
          <div className="flex gap-1.5 shrink-0">
            <button
              onClick={() => setAdding((v) => !v)}
              className="flex items-center gap-1 border text-xs px-2.5 py-1.5 rounded-md hover:bg-secondary"
            >
              <Plus size={12} /> Add Walk-in
            </button>
            <button
              onClick={notifyNext}
              disabled={busy || waiting.length === 0}
              className="flex items-center gap-1.5 bg-[oklch(0.18_0.06_260)] text-white text-xs px-3 py-1.5 rounded-md hover:bg-[oklch(0.25_0.08_260)] disabled:opacity-50"
            >
              <MessageCircle size={12} /> Call Next
            </button>
          </div>
        </div>

        {queuePace ? (
          <div className="mb-3 w-full flex items-center justify-center gap-3 rounded-lg border border-[oklch(0.85_0.08_245)] bg-[oklch(0.97_0.03_245)] px-4 py-3">
            <span className="text-[10px] tracking-wider text-[oklch(0.45_0.12_245)] uppercase">
              Expect to wait
            </span>
            <span className="text-3xl font-bold leading-none text-[oklch(0.35_0.15_245)]">
              ~{queuePace.avgWaitMin}
              <span className="text-base font-medium ml-1">min</span>
            </span>
            <span className="text-[10px] text-muted-foreground border-l pl-3">
              average of {queuePace.sampleSize} seen today
            </span>
          </div>
        ) : (
          <div className="mb-3 w-full rounded-lg border bg-secondary/40 px-4 py-3 text-center">
            <p className="text-xs text-muted-foreground">
              Expected wait appears once 2 patients have been seen today.
            </p>
          </div>
        )}

        <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 mb-3 pb-3 border-b">
          {(["red", "orange", "yellow", "green"] as TriageLevel[]).map((t) => (
            <span key={t} className="flex items-center gap-1.5">
              <span
                className={`w-2.5 h-2.5 rounded-full ${TRIAGE_COLORS[t].split(" ")[0]}`}
              />
              <span className="text-[10px] text-muted-foreground">
                {TRIAGE_LABELS[t]}
              </span>
            </span>
          ))}
        </div>

        {adding && (
          <form
            onSubmit={addWalkIn}
            className="mb-3 p-3 rounded-md bg-secondary/40 border space-y-2"
          >
            <div className="relative">
              <input
                value={walkInQuery}
                onChange={(e) => {
                  setWalkInQuery(e.target.value);
                  setDraft({ ...draft, patientId: "" });
                }}
                placeholder="Search patient name or ID…"
                className="w-full border rounded-md px-2.5 py-1.5 text-sm"
              />
              {walkInQuery.trim() && !draft.patientId && (
                <div className="absolute z-10 mt-1 w-full bg-white border rounded-md shadow-lg max-h-48 overflow-y-auto">
                  {walkInMatches.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-muted-foreground">
                      No match — try the exact Patient ID instead.
                    </div>
                  ) : (
                    walkInMatches.map((p) => (
                      <button
                        key={p.patientId}
                        type="button"
                        onClick={() => {
                          setDraft({ ...draft, patientId: p.patientId });
                          setWalkInQuery(`${p.name} (${p.patientId})`);
                        }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-secondary border-b last:border-b-0"
                      >
                        <div className="font-medium">{p.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {p.patientId}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            <input
              value={draft.reason}
              onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
              placeholder="Reason for visit"
              className="w-full border rounded-md px-2.5 py-1.5 text-sm"
            />
            <input
              value={draft.clinician}
              onChange={(e) =>
                setDraft({ ...draft, clinician: e.target.value })
              }
              placeholder="Assign clinician (optional)"
              className="w-full border rounded-md px-2.5 py-1.5 text-sm font-mono"
            />
            <div className="border rounded-md bg-white p-3">
              <p className="text-sm font-medium">Tick anything that applies</p>
              <p className="text-[11px] text-muted-foreground mb-2">
                Based on what you can see or what the patient tells you. The
                urgency level is worked out from your answers.
              </p>
              <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                {TRIAGE_QUESTIONS.map((q) => (
                  <label
                    key={q.id}
                    className="flex items-start gap-2 text-xs cursor-pointer hover:bg-secondary/50 rounded px-1 py-0.5"
                  >
                    <input
                      type="checkbox"
                      checked={triageFlags.has(q.id)}
                      onChange={(e) => {
                        const next = new Set(triageFlags);
                        if (e.target.checked) next.add(q.id);
                        else next.delete(q.id);
                        setTriageFlags(next);
                      }}
                      className="mt-0.5 shrink-0"
                    />
                    <span>{q.label}</span>
                  </label>
                ))}
              </div>

              <div className="mt-3 pt-3 border-t flex items-center gap-2 flex-wrap">
                <span className="text-[11px] text-muted-foreground">
                  Urgency:
                </span>
                <span
                  className={`text-[10px] font-bold px-2 py-1 rounded ${TRIAGE_COLORS[finalTriage]}`}
                >
                  {TRIAGE_SHORT[finalTriage]}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {TRIAGE_LABELS[finalTriage]}
                </span>
              </div>

              {computedTriage !== "red" && (
                <label className="flex items-start gap-2 mt-2 text-[11px] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={escalate}
                    onChange={(e) => setEscalate(e.target.checked)}
                    className="mt-0.5 shrink-0"
                  />
                  <span className="text-muted-foreground">
                    Something else worries me — move up one level
                  </span>
                </label>
              )}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setAdding(false)}
                className="flex-1 border py-1.5 rounded-md text-xs"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="flex-1 bg-[oklch(0.55_0.18_245)] text-white py-1.5 rounded-md text-xs disabled:opacity-60"
              >
                {busy ? "Adding..." : "Add to queue"}
              </button>
            </div>
          </form>
        )}

        {queueError && (
          <p className="text-xs text-destructive mb-2">
            Could not load live queue.
          </p>
        )}

        <ul className="space-y-2">
          {active.length === 0 ? (
            <li className="text-sm text-muted-foreground py-4 text-center">
              Queue is empty
            </li>
          ) : (
            active.map((q, idx) => {
              const waitMin = getWaitTime(q.joinedAt);
              const overdue = isOverdue(q);
              const target = TRIAGE_MAX_WAIT_MINUTES[q.triage];
              const position =
                q.status === "waiting"
                  ? active.filter((o, i) => o.status === "waiting" && i <= idx)
                      .length
                  : null;

              return (
                <li
                  key={q.id}
                  className="flex items-start gap-3 p-3 rounded-lg border bg-white hover:bg-secondary/30"
                >
                  <div className="w-9 shrink-0 text-center pt-0.5">
                    {position != null ? (
                      <>
                        <p className="text-xl font-bold leading-none">
                          {position}
                        </p>
                        <p className="text-[9px] text-muted-foreground mt-0.5">
                          in queue
                        </p>
                      </>
                    ) : (
                      <p className="text-lg leading-none pt-1">—</p>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-sm">{q.patientName}</p>
                      <span
                        className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${TRIAGE_COLORS[q.triage]}`}
                      >
                        {TRIAGE_SHORT[q.triage]}
                      </span>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full border ${STATUS_STYLE[q.status] ?? ""}`}
                      >
                        {STATUS_TEXT[q.status] ?? q.status}
                      </span>
                    </div>

                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {[q.patientId, q.reason].filter(Boolean).join(" · ")}
                    </p>

                    {/* Wait time. Over-target is a quiet amber marker, not a
                        red shout — reception can't speed up a clinician, but
                        they DO need to see when to escalate to a nurse. */}
                    <p className="text-xs mt-1.5 text-muted-foreground">
                      Waiting {waitMin} min
                      {target > 0 ? ` · target ${target} min` : " · immediate"}
                      {overdue && (
                        <span className="ml-2 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                          over target
                        </span>
                      )}
                    </p>

                    <p className="text-xs mt-0.5">
                      {q.handedOffTo ? (
                        <span className="text-purple-700">
                          Being handed to <strong>{q.handedOffTo}</strong>
                        </span>
                      ) : q.clinician ? (
                        <span className="text-slate-700">
                          Seeing <strong>{q.clinician}</strong>
                        </span>
                      ) : (
                        <span className="text-muted-foreground italic">
                          No clinician assigned yet
                        </span>
                      )}
                    </p>
                  </div>

                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <div className="flex gap-1 items-center">
                      {q.status === "waiting" && (
                        <>
                          <button
                            onClick={() => handleSetQueueStatus(q.id, "called")}
                            className="text-xs font-medium bg-blue-600 text-white px-3 py-1.5 rounded-md hover:bg-blue-700"
                          >
                            Call
                          </button>
                          <button
                            onClick={() =>
                              handleSetQueueStatus(q.id, "in-room")
                            }
                            className={BTN_SECONDARY}
                          >
                            Skip call
                          </button>
                        </>
                      )}
                      {q.status === "called" && (
                        <button
                          onClick={() => handleSetQueueStatus(q.id, "in-room")}
                          className={BTN_SECONDARY}
                        >
                          In room
                        </button>
                      )}
                      {q.status === "in-room" && (
                        <>
                          {handoffTarget === q.id ? (
                            <input
                              autoFocus
                              placeholder="To clinician"
                              className="w-28 text-xs border rounded-md px-2 py-1.5"
                              onKeyDown={(e) => {
                                if (e.key === "Enter")
                                  handleHandoff(q.id, e.currentTarget.value);
                                if (e.key === "Escape") setHandoffTarget(null);
                              }}
                            />
                          ) : (
                            <>
                              <button
                                onClick={() => setHandoffTarget(q.id)}
                                className="text-xs font-medium flex items-center gap-1 bg-purple-600 text-white px-3 py-1.5 rounded-md hover:bg-purple-700"
                              >
                                <ArrowRight size={12} /> Handoff
                              </button>
                              <button
                                onClick={() =>
                                  handleSetQueueStatus(q.id, "done")
                                }
                                className={BTN_SECONDARY}
                              >
                                Done
                              </button>
                            </>
                          )}
                        </>
                      )}
                      {q.status === "handoff" && (
                        <>
                          <button
                            onClick={() =>
                              handleAcceptHandoff(q.id, q.handedOffTo || "")
                            }
                            disabled={!q.handedOffTo}
                            className="text-xs font-medium flex items-center gap-1 bg-green-600 text-white px-3 py-1.5 rounded-md hover:bg-green-700 disabled:opacity-50"
                          >
                            <CheckCircle size={12} /> Accept
                          </button>
                          <button
                            onClick={() =>
                              handleSetQueueStatus(q.id, "in-room")
                            }
                            className={BTN_SECONDARY}
                          >
                            Cancel
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => handleRemoveFromQueue(q.id)}
                        title="Remove from queue"
                        className="text-sm w-8 h-8 flex items-center justify-center rounded-md border text-muted-foreground hover:text-destructive hover:border-destructive"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                </li>
              );
            })
          )}
        </ul>

        {(auditLogLoading || auditLogError || auditLog.length > 0) && (
          <div className="mt-4 pt-4 border-t">
            <div className="flex items-center gap-2 mb-2">
              <ClipboardList size={12} className="text-muted-foreground" />
              <p className="text-[10px] tracking-wider text-muted-foreground">
                AUDIT LOG (persisted to Firestore)
              </p>
            </div>
            {auditLogLoading && (
              <p className="text-xs text-muted-foreground">Loading…</p>
            )}
            {auditLogError && (
              <p className="text-xs text-destructive">
                Could not load audit log.
              </p>
            )}
            {!auditLogLoading && !auditLogError && (
              <ul className="text-xs space-y-1 max-h-64 overflow-y-auto">
                {auditLog.map((l, i) => (
                  <li
                    key={i}
                    className={
                      l.type === "critical"
                        ? "text-red-600 font-medium"
                        : l.type === "warn"
                          ? "text-orange-600"
                          : "text-muted-foreground"
                    }
                  >
                    <span className="font-mono mr-2">
                      {new Date(l.ts).toLocaleTimeString("en-ZA", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    {l.msg}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}

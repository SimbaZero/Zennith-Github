import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import {
  StaffSearchSelect,
  useClinicClinicians,
} from "@/components/StaffSearchSelect";
import { AuditEventList, type AuditRow } from "@/components/AuditEventList";
import { phraseQueueEvent } from "@/lib/audit-phrasing";
import {
  MessageCircle,
  Plus,
  ArrowRight,
  ArrowRightLeft,
  Check,
  CheckCircle,
  ChevronDown,
  ClipboardList,
  Clock,
  Megaphone,
  Stethoscope,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { useNow } from "@/lib/store";
import type { QueueEntry, TriageLevel } from "@/lib/clinic-data";
import {
  resolveCurrentReceptionist,
  useReceptionPatientDirectory,
} from "@/lib/clinic-data";

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

// The coloured left edge of a queue row, so urgency registers before any of
// the text is read. Same four triage colours as the pills.
const TRIAGE_EDGE: Record<TriageLevel, string> = {
  red: "bg-red-600",
  orange: "bg-orange-500",
  yellow: "bg-yellow-400",
  green: "bg-green-500",
};

// Only the two levels that need acting on now get a tint — tinting all four
// would make the list a block of colour and tell reception nothing.
const TRIAGE_ROW_TINT: Record<TriageLevel, string> = {
  red: "bg-red-50",
  orange: "bg-orange-50/60",
  yellow: "bg-white",
  green: "bg-white",
};

// Icon shown in place of a queue position for the statuses that don't have
// one — a patient already in a room isn't "4th in line", and a dash said
// nothing about where they actually are.
const STATUS_ICON: Record<string, LucideIcon> = {
  called: Megaphone,
  "in-room": Stethoscope,
  handoff: ArrowRightLeft,
};

// Touch targets. These rows are worked on a tablet, so every action is at
// least 40px tall and nothing in them is under 12px.
const BTN_BASE =
  "min-h-[40px] px-4 text-sm font-medium rounded-lg inline-flex items-center justify-center gap-1.5 transition-colors";
// One solid button per row — the next step for that patient. Signal blue.
const BTN_PRIMARY = `${BTN_BASE} bg-[oklch(0.55_0.18_245)] text-white hover:bg-[oklch(0.49_0.18_245)] disabled:opacity-50`;
const BTN_OUTLINE = `${BTN_BASE} border bg-white hover:bg-secondary`;

// How long a called patient can stay "called" before reception is prompted.
// Someone called but never marked as arrived stalls the queue silently —
// they're no longer waiting, but they're not being seen either.
const NO_SHOW_AFTER_MIN = 5;

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

// Same row shape as the admin Audit Logs page, so an event reads the same way
// in both places.
type LogEntry = AuditRow;

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
  // Reception's own directory hook, not doctor-service's usePatientDirectory:
  // that one opens every patient's medicalRecords doc, and reception has no
  // clinical role (POPIA — see the note above PatientSummary in clinic-data).
  const clinicPatients = useReceptionPatientDirectory(
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
  // Closed by default — the log is for looking back, not for working the queue.
  const [showLog, setShowLog] = useState(false);

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
            events.map((e, i) => {
              const p = phraseQueueEvent(e);
              return {
                id: e.id ?? `${e.entryId}-${e.action}-${i}`,
                when: e.timestamp?.toDate?.()
                  ? e.timestamp.toDate().toISOString()
                  : new Date().toISOString(),
                text: p.text,
                detail: p.detail ?? [],
                emphasis:
                  e.action === "handoff"
                    ? "warn"
                    : e.triage === "red"
                      ? "critical"
                      : undefined,
              };
            }),
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
  // Who the open handoff is going to — a staff id picked from the list.
  const [handoffChoice, setHandoffChoice] = useState("");
  useEffect(() => {
    setHandoffChoice("");
  }, [handoffTarget]);
  // Doctors and nurses at this clinic, for the walk-in "assign clinician" and
  // handoff pickers, instead of typing a raw ID like "Doc-3".
  const {
    clinicians,
    loading: cliniciansLoading,
    error: cliniciansError,
  } = useClinicClinicians(receptionist?.clinicId);

  const active = queue.filter((q) => q.status !== "done");
  const waiting = active.filter(
    (q) => q.status === "waiting" || q.status === "called",
  );
  const stalled = active.filter(
    (q) =>
      q.status === "called" &&
      q.calledAt &&
      (now.getTime() - new Date(q.calledAt).getTime()) / 60000 >
        NO_SHOW_AFTER_MIN,
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
    // The queue functions now refuse offline by THROWING (assertOnline), not
    // by returning { ok: false }. Without this catch the rejection would be
    // unhandled and `busy` would stay true, leaving the button stuck — the
    // exact failure the offline work is meant to remove.
    try {
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
      if (!res.ok) return toast.error(res.error ?? "Could not add to queue");
      toast.success(`${draft.patientId} added — ${TRIAGE_LABELS[finalTriage]}`);
      setDraft({ patientId: "", reason: "", clinician: "" });
      setTriageFlags(new Set());
      setEscalate(false);
      setWalkInQuery("");
      setAdding(false);
    } catch (err) {
      // err.message, not a generic string — assertOnline's message explains
      // that nothing was saved and why.
      toast.error(
        err instanceof Error ? err.message : "Could not add to queue",
      );
    } finally {
      setBusy(false);
    }
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
        id: `local-${Date.now()}`,
        when: new Date().toISOString(),
        text: `Reception called ${next.patientName} in`,
        detail: next.clinician ? [`Sent to ${next.clinician}`] : [],
      };
      setAuditLog((l) => [entry, ...l].slice(0, 20));
      toast.success(
        `${next.patientName} called — proceed to ${next.clinician || "triage"}`,
      );
    } catch (err) {
      // Surface the real reason (e.g. the offline message) instead of a
      // generic line that tells the user nothing about what to do next.
      toast.error(
        err instanceof Error ? err.message : "Could not notify patient",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleHandoff = async (entryId: string, targetClinician: string) => {
    if (!targetClinician.trim()) return toast.error("Enter target clinician");
    setBusy(true);
    // Same as addWalkIn: handoffPatient can now throw when offline.
    try {
      const { handoffPatient } = await getClinicData();
      const res = await handoffPatient(entryId, targetClinician);
      setHandoffTarget(null);
      if (!res.ok) return toast.error(res.error ?? "Handoff failed");
      toast.success(`Handed off to ${targetClinician}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Handoff failed");
    } finally {
      setBusy(false);
    }
  };

  const handleAcceptHandoff = async (entryId: string, clinicianId: string) => {
    setBusy(true);
    try {
      const { acceptHandoff } = await getClinicData();
      const res = await acceptHandoff(entryId, clinicianId);
      if (!res.ok) return toast.error(res.error ?? "Accept failed");
      toast.success("Handoff accepted — patient is now yours");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Accept failed");
    } finally {
      setBusy(false);
    }
  };

  const handleSetQueueStatus = async (
    id: string,
    status: QueueEntry["status"],
  ) => {
    // These two had no error handling at all — a rejection went nowhere and
    // the row simply didn't move, with nothing said. Now that they refuse
    // offline, the user has to be told why.
    try {
      const { setQueueStatus } = await getClinicData();
      await setQueueStatus(id, status);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not update the queue",
      );
    }
  };

  const handleRemoveFromQueue = async (id: string) => {
    try {
      const { removeFromQueue } = await getClinicData();
      await removeFromQueue(id);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not remove from the queue",
      );
    }
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
      >
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">Loading queue system...</p>
        </div>
      </AppShell>
    );
  }

  // The active queue in three parts. Each row carries its index in `active`
  // (see renderRow) rather than its place in the group.
  const indexedActive = active.map((q, idx) => ({ q, idx }));
  const queueGroups = [
    {
      key: "waiting",
      title: "Waiting",
      icon: Clock,
      hint: "Not yet called",
      empty: "No one waiting",
      rows: indexedActive.filter(({ q }) => q.status === "waiting"),
    },
    {
      key: "called",
      title: "Called",
      icon: Megaphone,
      hint: "Paged — not in the room yet",
      empty: "No one called right now",
      rows: indexedActive.filter(({ q }) => q.status === "called"),
    },
    {
      key: "in-room",
      title: "In Room",
      icon: Stethoscope,
      hint: "With a clinician",
      empty: "No one in a room right now",
      rows: indexedActive.filter(
        ({ q }) => q.status === "in-room" || q.status === "handoff",
      ),
    },
  ];

  // One queue row. `idx` is the patient's index in `active`, NOT in their
  // group: the "in queue" number is counted from that index, so splitting the
  // list into sections must hand each row the same index it had before.
  const renderRow = (q: QueueEntry, idx: number) => {
    const waitMin = getWaitTime(q.joinedAt);
    const overdue = isOverdue(q);
    const target = TRIAGE_MAX_WAIT_MINUTES[q.triage];
    const position =
      q.status === "waiting"
        ? active.filter((o, i) => o.status === "waiting" && i <= idx).length
        : null;
    // Same button in two places: on a phone the action row is full of "Call"
    // and "Already with clinician", so a third button there wraps onto a line
    // of its own. Up beside the position badge it costs no height; from
    // tablet width it goes back to the far right of the action row.
    const removeButton = (placement: string) => (
      <button
        onClick={() => handleRemoveFromQueue(q.id)}
        title="Remove from queue"
        className={`${placement} w-10 h-10 shrink-0 items-center justify-center rounded-lg text-lg text-muted-foreground/70 hover:bg-secondary hover:text-destructive`}
      >
        ×
      </button>
    );
    // Patients with no queue position are somewhere specific —
    // called, in a room, or being handed over — so say which.
    const StatusIcon =
      position == null ? (STATUS_ICON[q.status] ?? ArrowRight) : null;

    return (
      <li
        key={q.id}
        className={`relative overflow-hidden rounded-xl border transition-shadow hover:shadow-sm ${TRIAGE_ROW_TINT[q.triage]}`}
      >
        {/* Urgency before the text: a 5px edge in the triage
                      colour, with a faint matching tint on red and orange. */}
        <span
          aria-hidden
          className={`absolute left-0 top-0 bottom-0 w-[5px] ${TRIAGE_EDGE[q.triage]}`}
        />

        <div className="flex flex-col gap-3 p-3 pl-5 sm:grid sm:grid-cols-[3.5rem_1fr] sm:gap-x-3 xl:grid-cols-[3.5rem_1fr_auto] xl:items-start">
          <div className="flex items-center gap-3 shrink-0 sm:w-14 sm:flex-col sm:gap-1">
            {position != null ? (
              <>
                <span className="w-10 h-10 shrink-0 rounded-full bg-[oklch(0.55_0.18_245)] text-white text-base font-bold flex items-center justify-center">
                  {position}
                </span>
                <span className="text-xs text-muted-foreground">in queue</span>
              </>
            ) : (
              <span
                title={STATUS_TEXT[q.status] ?? q.status}
                className="w-10 h-10 shrink-0 rounded-full border bg-white text-muted-foreground flex items-center justify-center"
              >
                {StatusIcon ? <StatusIcon size={18} /> : null}
              </span>
            )}
            {removeButton("flex sm:hidden ml-auto")}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-base font-semibold">{q.patientName}</p>
              <span
                className={`text-xs font-semibold px-2.5 py-1 rounded-full ${TRIAGE_COLORS[q.triage]}`}
              >
                {TRIAGE_SHORT[q.triage]}
              </span>
              <span
                className={`text-xs px-2.5 py-1 rounded-full border ${STATUS_STYLE[q.status] ?? ""}`}
              >
                {STATUS_TEXT[q.status] ?? q.status}
              </span>
              {/* The patient tapped "I'm on my way". Informational
                            only — it says the call was heard, not that anyone
                            has arrived, so no button reads it and the no-show
                            prompt below still applies. */}
              {q.patientAcknowledgedAt && (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Check size={14} /> Confirmed coming
                </span>
              )}
            </div>

            <p className="text-xs text-muted-foreground mt-1">
              {[q.patientId, q.reason].filter(Boolean).join(" · ")}
            </p>

            {/* Called but never arrived. Without this the entry just
                          sits as "Called" indefinitely and nobody notices. */}
            {q.status === "called" &&
              q.calledAt &&
              (now.getTime() - new Date(q.calledAt).getTime()) / 60000 >
                NO_SHOW_AFTER_MIN && (
                <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2">
                  <p className="text-xs text-amber-900">
                    Called{" "}
                    {Math.round(
                      (now.getTime() - new Date(q.calledAt).getTime()) / 60000,
                    )}{" "}
                    min ago but hasn't arrived.
                  </p>
                  <div className="flex flex-wrap gap-2 mt-2">
                    <button
                      onClick={() => handleSetQueueStatus(q.id, "waiting")}
                      className={BTN_OUTLINE}
                    >
                      Put back in queue
                    </button>
                    <button
                      onClick={() => handleRemoveFromQueue(q.id)}
                      className={BTN_OUTLINE}
                    >
                      Mark as no-show
                    </button>
                  </div>
                </div>
              )}

            {/* Wait time stays plain text. The numbers in
                          TRIAGE_MAX_WAIT_MINUTES are the SATS guideline for
                          the level, not a wait this clinic is promising — a
                          filling bar reads as exactly that promise, down to
                          the minute, which no clinic can make. Past the
                          guideline is an amber note, not a red one: reception
                          can't speed up a clinician, they just need to know
                          when to escalate to a nurse. */}
            <p className="mt-2 text-sm">
              <span
                className={
                  overdue
                    ? "font-medium text-amber-700"
                    : "text-muted-foreground"
                }
              >
                Waiting {waitMin} min
              </span>
              {target === 0 ? (
                <span
                  className={
                    overdue ? "text-amber-700" : "text-muted-foreground"
                  }
                >
                  {" "}
                  · should be seen immediately
                </span>
              ) : (
                overdue && (
                  <span className="text-amber-700">
                    {" "}
                    — past the usual SATS guideline for this level
                  </span>
                )
              )}
            </p>

            <p className="text-xs mt-1.5">
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

          {/* One solid button per row — the next step for this
                        patient. Everything else is outlined so there is never
                        a question of what to press. */}
          <div className="flex flex-wrap items-center gap-2 w-full sm:col-start-2 xl:col-start-3 xl:row-start-1 xl:w-auto xl:shrink-0">
            {q.status === "waiting" && (
              <>
                <button
                  onClick={() => handleSetQueueStatus(q.id, "called")}
                  className={BTN_PRIMARY}
                >
                  Call
                </button>
                {/* For a patient already standing at the desk: goes
                              straight to "With clinician" and skips the page,
                              so no notification is sent. Call (above) is the
                              path that notifies. */}
                <button
                  onClick={() => handleSetQueueStatus(q.id, "in-room")}
                  title="The patient is already at the desk — move them straight to With clinician without paging them"
                  className={BTN_OUTLINE}
                >
                  Already with clinician
                </button>
              </>
            )}
            {q.status === "called" && (
              <button
                onClick={() => handleSetQueueStatus(q.id, "in-room")}
                className={BTN_PRIMARY}
              >
                In room
              </button>
            )}
            {q.status === "in-room" && (
              <>
                {handoffTarget === q.id ? (
                  <div className="w-full sm:w-72 space-y-2">
                    <StaffSearchSelect
                      id={`handoff-${q.id}`}
                      autoFocus
                      inlineList
                      options={clinicians}
                      value={handoffChoice}
                      onChange={setHandoffChoice}
                      loading={cliniciansLoading}
                      error={cliniciansError}
                      placeholder="Hand off to… (name or ID)"
                      pendingHint="Choose who to hand over to from the list."
                      inputClassName="w-full min-h-[40px] text-sm border rounded-lg px-3 bg-white outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)]"
                      onEscape={() => setHandoffTarget(null)}
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleHandoff(q.id, handoffChoice)}
                        disabled={!handoffChoice || busy}
                        className={BTN_PRIMARY}
                      >
                        Hand off
                      </button>
                      <button
                        onClick={() => setHandoffTarget(null)}
                        className={BTN_OUTLINE}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={() => handleSetQueueStatus(q.id, "done")}
                      className={BTN_PRIMARY}
                    >
                      Done
                    </button>
                    <button
                      onClick={() => setHandoffTarget(q.id)}
                      className={BTN_OUTLINE}
                    >
                      <ArrowRight size={14} /> Handoff
                    </button>
                  </>
                )}
              </>
            )}
            {q.status === "handoff" && (
              <>
                <button
                  onClick={() => handleAcceptHandoff(q.id, q.handedOffTo || "")}
                  disabled={!q.handedOffTo}
                  className={BTN_PRIMARY}
                >
                  <CheckCircle size={14} /> Accept
                </button>
                <button
                  onClick={() => handleSetQueueStatus(q.id, "in-room")}
                  className={BTN_OUTLINE}
                >
                  Cancel
                </button>
              </>
            )}
            {removeButton("hidden sm:flex ml-auto")}
          </div>
        </div>
      </li>
    );
  };

  return (
    <AppShell
      role="receptionist"
      title="Acute Care Queue"
      clinicNameOverride={receptionist?.clinicName}
    >
      {stalled.length > 0 && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 flex items-center gap-3">
          <p className="text-sm text-amber-900">
            <strong>
              {stalled.length} patient{stalled.length === 1 ? "" : "s"}
            </strong>{" "}
            called but not arrived — re-call them or mark as no-show so the
            queue keeps moving.
          </p>
        </div>
      )}

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
              <span className="text-xs text-muted-foreground">
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
            <StaffSearchSelect
              id="walkin-clinician"
              options={clinicians}
              value={draft.clinician}
              onChange={(staffId) => setDraft({ ...draft, clinician: staffId })}
              loading={cliniciansLoading}
              error={cliniciansError}
              placeholder="Assign clinician (optional) — search name or ID"
              pendingHint="Choose someone from the list, or clear this box to leave the patient unassigned."
              inputClassName="w-full border rounded-md px-2.5 py-1.5 text-sm bg-white"
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

        {/* Three parts, so it's clear who has been paged but hasn't arrived
            (Called) rather than lumping them in with people still waiting.
            An empty part stays as a single muted line so the structure is
            always visible. Handoffs sit in "In Room": they're with a clinician
            and being passed to another. */}
        <div className="space-y-6">
          {queueGroups.map((g) => {
            const GroupIcon = g.icon;
            return (
              <section key={g.key} aria-labelledby={`queue-group-${g.key}`}>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pb-2 mb-2 border-b">
                  <GroupIcon size={16} className="text-muted-foreground" />
                  <h4
                    id={`queue-group-${g.key}`}
                    className="text-sm font-semibold"
                  >
                    {g.title}
                  </h4>
                  <span
                    className={`text-xs font-medium px-2 py-0.5 rounded-full border ${STATUS_STYLE[g.key]}`}
                  >
                    {g.rows.length}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {g.hint}
                  </span>
                </div>
                {g.rows.length === 0 ? (
                  <p className="text-sm text-muted-foreground px-1 py-2">
                    {g.empty}
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {g.rows.map(({ q, idx }) => renderRow(q, idx))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>

        {/* Collapsed until asked for. Same events the admin sees on their Audit
            Logs page — both read the queueAudit collection for this clinic. */}
        <div className="mt-4 pt-4 border-t">
          <button
            onClick={() => setShowLog((v) => !v)}
            aria-expanded={showLog}
            className="w-full min-h-[40px] flex items-center gap-2 text-left"
          >
            <ClipboardList size={14} className="text-muted-foreground" />
            <span className="text-sm font-medium">
              {showLog ? "Hide activity log" : "View activity log"}
            </span>
            <ChevronDown
              size={14}
              className={`text-muted-foreground transition ${
                showLog ? "rotate-180" : ""
              }`}
            />
          </button>
          {showLog && (
            <div className="mt-2 border rounded-lg overflow-hidden">
              {auditLogLoading && (
                <p className="px-5 py-4 text-sm text-muted-foreground">
                  Loading…
                </p>
              )}
              {auditLogError && (
                <p className="px-5 py-4 text-sm text-destructive">
                  Could not load the activity log.
                </p>
              )}
              {!auditLogLoading && !auditLogError && (
                <div className="max-h-80 overflow-y-auto">
                  <AuditEventList
                    rows={auditLog}
                    tone="queue"
                    empty="No activity recorded yet."
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

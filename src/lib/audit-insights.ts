import type { QueueAuditEvent } from "@/lib/clinic-data";
import type { SystemLog } from "@/lib/audit";

// Turns raw audit history into things worth someone's attention.
// Every flag below is computed from real recorded events — nothing is
// inferred or guessed. If the data can't support a finding, there's no flag.
//
// NOT detectable with current data: email/password changes (never logged),
// anything about staffing levels, or why a delay happened.

export type Severity = "critical" | "warning" | "info";

export interface Flag {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  /** Audit rows that justify this flag — shown when the user opens it. */
  evidence: { when: string; text: string }[];
}

const TARGETS: Record<string, number> = {
  red: 0,
  orange: 10,
  yellow: 30,
  green: 60,
};

const ts = (e: QueueAuditEvent) =>
  e.timestamp?.toDate?.() ? e.timestamp.toDate() : new Date();

export function buildFlags(
  queueEvents: QueueAuditEvent[],
  staffLogs: SystemLog[],
): Flag[] {
  const flags: Flag[] = [];

  // Group queue events per patient visit so we can reconstruct timelines.
  const byEntry = new Map<string, QueueAuditEvent[]>();
  for (const e of queueEvents) {
    if (!byEntry.has(e.entryId)) byEntry.set(e.entryId, []);
    byEntry.get(e.entryId)!.push(e);
  }

  for (const [entryId, events] of byEntry) {
    const ordered = [...events].sort(
      (a, b) => ts(a).getTime() - ts(b).getTime(),
    );
    const first = ordered[0];
    if (!first) continue;

    const evidence = ordered.map((e) => ({
      when: ts(e).toISOString(),
      text: `${e.action} — ${e.details}${e.by ? ` (by ${e.by})` : ""}`,
    }));

    const joined = ts(ordered[0]);
    const called = ordered.find((e) => e.action === "called");
    const target = TARGETS[first.triage] ?? 30;

    // 1. Someone urgent waited well past their target.
    if (called) {
      const waited = (ts(called).getTime() - joined.getTime()) / 60000;
      const overBy = Math.round(waited - target);
      if (overBy > 0 && (first.triage === "red" || first.triage === "orange")) {
        flags.push({
          id: `wait-${entryId}`,
          severity: overBy > target ? "critical" : "warning",
          title: `${first.triage === "red" ? "Critical" : "Emergent"} patient waited ${Math.round(waited)} min`,
          detail: `${first.patientId} should have been seen within ${target} min — waited ${overBy} min longer. Worth checking what held things up.`,
          evidence,
        });
      }
    }

    // 2. Left the queue without ever being called.
    const removed = ordered.find((e) => e.action === "removed");
    if (removed && !called) {
      flags.push({
        id: `unseen-${entryId}`,
        severity: first.triage === "red" ? "critical" : "warning",
        title: "Patient left the queue without being seen",
        detail: `${first.patientId} (${first.triage.toUpperCase()}) was removed before anyone called them.`,
        evidence,
      });
    }

    // 3. Handoff started, never accepted — patient can fall between clinicians.
    const handoff = ordered.find((e) => e.action === "handoff");
    const accepted = ordered.find((e) => e.action === "accept-handoff");
    const done = ordered.find((e) => e.action === "done");
    if (handoff && !accepted && !done) {
      flags.push({
        id: `handoff-${entryId}`,
        severity: "warning",
        title: "Handoff never accepted",
        detail: `${first.patientId} was handed over but nobody picked them up.`,
        evidence,
      });
    }
  }

  // 4. Staff account created then removed within 24h.
  const created = staffLogs.filter((l) => l.action_type === "staff.create");
  const removedStaff = staffLogs.filter(
    (l) => l.action_type === "staff.remove",
  );
  for (const c of created) {
    const nameMatch = c.description.match(/"([^"]+)"/);
    if (!nameMatch) continue;
    const username = nameMatch[1];
    const gone = removedStaff.find((r) =>
      r.description.includes(`"${username}"`),
    );
    if (!gone) continue;
    const hours =
      (new Date(gone.timestamp).getTime() - new Date(c.timestamp).getTime()) /
      3_600_000;
    if (hours >= 0 && hours < 24) {
      flags.push({
        id: `shortlived-${username}`,
        severity: "warning",
        title: "Staff account created then removed same day",
        detail: `"${username}" existed for about ${Math.max(1, Math.round(hours))}h. Usually a mistake — worth confirming it was intentional.`,
        evidence: [
          { when: c.timestamp, text: `${c.description} (by ${c.actor_id})` },
          {
            when: gone.timestamp,
            text: `${gone.description} (by ${gone.actor_id})`,
          },
        ],
      });
    }
  }

  const rank: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
  return flags.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/** Plain counts for the stats strip — all from real timestamps. */
export function buildStats(queueEvents: QueueAuditEvent[]) {
  const called = queueEvents.filter((e) => e.action === "called");
  const byHour = new Map<number, number>();
  for (const e of queueEvents) {
    const h = ts(e).getHours();
    byHour.set(h, (byHour.get(h) ?? 0) + 1);
  }
  let busiestHour: number | null = null;
  let busiestCount = 0;
  for (const [h, n] of byHour) {
    if (n > busiestCount) {
      busiestCount = n;
      busiestHour = h;
    }
  }
  return {
    totalEvents: queueEvents.length,
    patientsCalled: called.length,
    busiestHour,
    busiestCount,
  };
}

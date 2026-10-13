// How long a patient has been "called" without turning up, and how loudly the
// reception queue should say so.
//
// Calling a patient and then losing track of them stalls the queue silently:
// they're no longer waiting, but they aren't being seen either, and the only
// fix used to be the receptionist noticing and physically calling the name
// again. These thresholds turn that into something the screen points at.

/** Minutes after the call at which a row starts to stand out (amber). */
export const CALLED_WATCH_MIN = 3;
/** Minutes after the call at which it becomes an alert (red) and reception is prompted to act. */
export const CALLED_ALERT_MIN = 5;

export type CalledAttentionLevel = "none" | "watch" | "alert";

export interface CalledAttention {
  level: CalledAttentionLevel;
  /** Whole minutes since they were called (0 when not applicable). */
  minutes: number;
  /** The patient tapped "I'm on my way". That's a sign the call was heard, not that they've arrived. */
  acknowledged: boolean;
}

/**
 * Only a patient in the "called" state can be overdue to arrive. Someone who
 * said they're on their way is still flagged at the same threshold - being
 * "on my way" five minutes ago and not here is exactly what reception needs to
 * chase - but is described differently.
 */
export function calledAttention(
  entry: {
    status: string;
    calledAt: string | null;
    patientAcknowledgedAt: string | null;
  },
  now: Date,
): CalledAttention {
  const none: CalledAttention = {
    level: "none",
    minutes: 0,
    acknowledged: false,
  };
  if (entry.status !== "called" || !entry.calledAt) return none;
  const calledMs = Date.parse(entry.calledAt);
  if (!Number.isFinite(calledMs)) return none;
  const minutes = Math.max(0, (now.getTime() - calledMs) / 60_000);
  const acknowledged = !!entry.patientAcknowledgedAt;
  const level: CalledAttentionLevel =
    minutes > CALLED_ALERT_MIN
      ? "alert"
      : minutes >= CALLED_WATCH_MIN
        ? "watch"
        : "none";
  return { level, minutes: Math.floor(minutes), acknowledged };
}

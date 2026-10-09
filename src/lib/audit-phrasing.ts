import type { QueueAuditEvent } from "@/lib/clinic-data";
import type { SystemLog } from "@/lib/audit";

// Turns raw audit records into a sentence a person can read, e.g.
//   "Reception updated Pat-204's personal details"
// instead of "patient.update · receptionist · Pat-204".
//
// Used by the admin Audit Logs page AND the activity log at the bottom of the
// reception queue, so the same event reads the same way in both places.
//
// This only rewords what was recorded. The descriptions written by logAction()
// and logQueueEvent() are free text built in a handful of known places, so each
// phrase below parses the shape that one place writes. If a record doesn't
// match any known shape it falls back to the recorded text — it never drops or
// guesses at what happened.

export interface PhrasedEvent {
  /** One plain sentence, without the time (the row shows that separately). */
  text: string;
  /** Extra lines worth a click to see; leave out anything the sentence says. */
  detail?: string[];
}

const TRIAGE_WORD: Record<string, string> = {
  red: "critical",
  orange: "emergent",
  yellow: "urgent",
  green: "routine",
};

/** "personal details, insurance" -> "personal details and insurance" */
function listWords(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** "2026-10-12" -> "12 Oct". Built from the parts so no timezone can shift the day. */
function shortDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
  ).toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
}

const ROLE_WORD: Record<string, string> = {
  receptionist: "Reception",
  reception: "Reception",
  nurse: "A nurse",
  doctor: "A doctor",
  pharmacist: "A pharmacist",
  admin: "An admin",
  patient: "A patient",
};

/**
 * Who did it, as far as the record says. Staff ids ("Rec-1", "Nur-3") carry
 * their role in the prefix; admin account actions are by definition an admin.
 * A bare username is not echoed in the sentence — it can be an email address.
 */
function actorLabel(actorId: string, type: string): string {
  if (/^rec-/i.test(actorId) || actorId.toLowerCase() === "receptionist")
    return "Reception";
  if (/^nur-/i.test(actorId)) return "A nurse";
  if (/^doc-/i.test(actorId)) return "A doctor";
  if (/^pharm-/i.test(actorId)) return "A pharmacist";
  if (/^pat-/i.test(actorId)) return actorId;
  if (actorId.toLowerCase() === "superadmin") return "The super admin";
  if (type.startsWith("staff.")) return "An admin";
  return "Someone";
}

const ROLE_WITH_ARTICLE: Record<string, string> = {
  super_admin: "the super admin",
  admin: "an admin",
  doctor: "a doctor",
  nurse: "a nurse",
  pharmacist: "a pharmacist",
  receptionist: "a receptionist",
  patient: "a patient",
};
const roleWithArticle = (role: string) =>
  ROLE_WITH_ARTICLE[role] ?? role.replace(/_/g, " ");

const looksLikeStaffOrPatientId = (id: string) =>
  /^(rec|nur|doc|pharm|pat)-/i.test(id);

/** One staff/system event (the `systemAudit` collection). */
export function phraseStaffLog(log: SystemLog): PhrasedEvent {
  const d = log.description;
  const who = actorLabel(log.actor_id, log.action_type);
  // The username an admin signed in as — shown inside the expandable detail
  // rather than the sentence, since that field isn't always a tidy name.
  const signedInAs =
    log.action_type.startsWith("staff.") &&
    log.actor_id &&
    log.actor_id !== "system" &&
    !looksLikeStaffOrPatientId(log.actor_id)
      ? [`Done by the account "${log.actor_id}"`]
      : [];

  switch (log.action_type) {
    case "auth.login_failed": {
      const m = /^Failed sign-in for "([^"]+)": (.+)$/.exec(d);
      if (m) return { text: `Failed sign-in attempt for "${m[1]}" (${m[2]})` };
      break;
    }
    case "auth.login_dev_bypass": {
      // The developer 2FA shortcut (see two-factor.tsx). Spelled out in full so
      // it can't be mistaken for an ordinary sign-in.
      const m = /^"([^"]+)" signed in as (\w+) with the DEV 2FA bypass/.exec(d);
      if (m)
        return {
          text: `"${m[1]}" signed in as ${roleWithArticle(m[2])} using the developer 2FA bypass — no code was entered`,
        };
      break;
    }
    case "auth.login_success": {
      const m = /^"([^"]+)" signed in as (\w+)$/.exec(d);
      if (m) return { text: `"${m[1]}" signed in as ${roleWithArticle(m[2])}` };
      break;
    }
    case "staff.create": {
      const m = /^Created (\w+) account "([^"]+)"/.exec(d);
      if (m)
        return {
          text: `${who} created ${m[1] === "admin" ? "an" : "a"} ${m[1]} login for "${m[2]}"`,
          detail: signedInAs.length ? signedInAs : undefined,
        };
      break;
    }
    case "staff.login_created": {
      const m = /^Created a login for existing (\w+) (\S+) \((.+)\)$/.exec(d);
      if (m)
        return {
          text: `${who} created a login for ${m[3]} (${m[2]}, ${m[1]})`,
          detail: signedInAs.length ? signedInAs : undefined,
        };
      break;
    }
    case "staff.update": {
      const m = /^Updated details for "([^"]+)" \((.+)\)$/.exec(d);
      if (m)
        return {
          text: `${who} updated the details for "${m[1]}"`,
          detail: [
            m[2].startsWith("name: ")
              ? `Name is now ${m[2].slice("name: ".length)}`
              : `Changed: ${m[2]}`,
            ...signedInAs,
          ],
        };
      break;
    }
    case "staff.remove": {
      const m = /^Revoked account "([^"]+)"/.exec(d);
      if (m)
        return {
          text: `${who} removed the login for "${m[1]}"`,
          detail: signedInAs.length ? signedInAs : undefined,
        };
      break;
    }
    case "patient.update": {
      const m = /^\w+ updated patient file for (\S+) \((.+)\)$/.exec(d);
      if (m) {
        const sections = m[2].split(",").map((s) => s.trim());
        // One section reads naturally in the sentence; several are listed in
        // the expandable detail so the default view stays short.
        return sections.length === 1
          ? { text: `${who} updated ${m[1]}'s ${sections[0]}` }
          : {
              text: `${who} updated ${m[1]}'s file`,
              detail: [`Sections changed: ${listWords(sections)}`],
            };
      }
      break;
    }
    case "patient.register": {
      const m = /^(\w+) registered new patient (\S+)/.exec(d);
      if (m)
        return {
          text: `${ROLE_WORD[m[1].toLowerCase()] ?? who} registered new patient ${m[2]}`,
        };
      break;
    }
    case "appointment.create": {
      const m =
        /^(\w+) booked appointment #(\d+) for (\S+) with (.+) on (\d{4}-\d{2}-\d{2}) at (\d{2}:\d{2})$/.exec(
          d,
        );
      if (m)
        return {
          text: `${ROLE_WORD[m[1].toLowerCase()] ?? who} booked ${m[3]} in with ${m[4]} for ${shortDate(m[5])} at ${m[6]}`,
          detail: [`Appointment #${m[2]}`],
        };
      break;
    }
    case "stock.external": {
      const m = /^Recorded (.+) from (.+) \(supplier not on Zennith\)$/.exec(d);
      if (m)
        return {
          text: `${who} recorded ${m[1]} from ${m[2]}, a supplier that isn't on Zennith`,
          detail: [`Recorded by ${log.actor_id}`],
        };
      break;
    }
    case "privacy.deletion_request": {
      const m = /^(\S+) requested deactivation/.exec(d);
      if (m)
        return {
          text: `${m[1]} asked for their account and data to be deactivated`,
        };
      break;
    }
    case "privacy.deletion_resolved": {
      const m = /^Deletion request for (\S+) marked (\w+): (.*)$/.exec(d);
      if (m)
        return {
          text: `The deletion request from ${m[1]} was marked ${m[2]}`,
          detail: [`Note recorded: ${m[3]}`],
        };
      break;
    }
    case "clinic.application_decision": {
      const first = d.split(/\.\s/)[0];
      const rest = d.slice(first.length + 1).trim();
      return { text: first, detail: rest ? [rest] : undefined };
    }
  }

  // Fast Lane changes and pharmacy handovers are already written as sentences
  // by the code that records them, so they are shown as recorded.
  if (
    log.action_type === "patient.fast_lane_changed" ||
    log.action_type === "pharmacist.medication_handover"
  ) {
    return { text: d.replace(/\.$/, "") };
  }

  return { text: d || log.action_type.replace(/[._]/g, " ") };
}

/** One patient-queue event (the `queueAudit` collection). */
export function phraseQueueEvent(e: QueueAuditEvent): PhrasedEvent {
  const pid = e.patientId || "A patient";
  const triage = TRIAGE_WORD[e.triage];
  const details = e.details ?? "";

  switch (e.action) {
    case "added": {
      const reason = details.replace(/^Added to queue:\s*/, "").trim();
      return {
        text: `Reception added ${pid} to the queue${triage ? ` as ${triage}` : ""}`,
        detail:
          reason && reason !== "Walk-in" ? [`Reason: ${reason}`] : undefined,
      };
    }
    case "called": {
      const by = /^Called by (.+)$/.exec(details)?.[1];
      return {
        text: `Reception called ${pid} in`,
        detail: by && by !== "reception" ? [`Sent to ${by}`] : undefined,
      };
    }
    case "in-room":
      return { text: `Reception moved ${pid} in to see a clinician` };
    case "waiting":
      return { text: `Reception put ${pid} back in the queue` };
    case "done":
      return { text: `Reception marked ${pid}'s visit as finished` };
    case "removed":
      return { text: `Reception removed ${pid} from the queue` };
    case "handoff": {
      const m = /^Handed off from (.+) to (.+)$/.exec(details);
      return m
        ? {
            text: `Reception handed ${pid} over to ${m[2]}`,
            detail: [`Handed over from ${m[1]}`],
          }
        : { text: `Reception handed ${pid} over to another clinician` };
    }
    case "accept-handoff": {
      const m = /^(.+) accepted handoff from (.+)$/.exec(details);
      return m
        ? { text: `${m[1]} accepted ${pid} from ${m[2]}` }
        : { text: `A handoff for ${pid} was accepted` };
    }
    case "escalation": {
      const m = /^Waited (\d+) min/.exec(details);
      return {
        text: m
          ? `Reception was alerted that ${pid} had waited ${m[1]} min past their target`
          : `Reception was alerted that ${pid} had waited past their target`,
      };
    }
  }
  return {
    text: `${e.action.replace(/[-_]/g, " ")} for ${pid}`,
    detail: details ? [details] : undefined,
  };
}

/** "14:32" — the same short time everywhere an event is listed. */
export function eventTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" });
}

import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { assertOnline } from "@/lib/offline";
import { logAction } from "@/lib/audit";
import { notifyUser, userIdForStaff } from "@/lib/notify";
import {
  appointmentDateTimeLabel,
  appointmentStart,
  isUpcomingAppointmentStrict,
} from "@/lib/appointment-time";

// Reschedule requests.
//
// A patient can't move an appointment themselves (and shouldn't: the clinician's
// diary is the clinic's to arrange). They ASK, and a doctor or nurse answers.
// The request is its own document; the appointment it refers to is not touched
// while the request is pending, and not touched if it is declined or withdrawn.
// Only ACCEPTING moves it - to the time the clinician chooses.

export type RescheduleStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "withdrawn";

export interface RescheduleRequest {
  id: string;
  appointmentId: string;
  patientId: string;
  /** The patient's numeric user id - where notifications to them are addressed. */
  patientUserId: number | null;
  /** Doc-1 / Nur-3: whose diary the appointment is in, and who answers. */
  clinician: string;
  /** The appointment's time when the request was made (clinic wall-clock, Z). */
  appointmentDateTime: string;
  appointType: string;
  reason: string;
  /** Optional: when the patient would prefer instead. */
  preferredDay: string | null;
  preferredTime: string | null;
  status: RescheduleStatus;
  createdAt: string;
  // Set when it is answered
  newDateTime?: string;
  declineReason?: string;
  resolvedBy?: string;
  resolvedAt?: string;
}

const COLLECTION = "rescheduleRequests";

function fromDoc(id: string, d: Record<string, unknown>): RescheduleRequest {
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const status = ["pending", "accepted", "declined", "withdrawn"].includes(
    String(d.status),
  )
    ? (d.status as RescheduleStatus)
    : "pending";
  return {
    id,
    appointmentId: str(d.appointmentId),
    patientId: str(d.patientId),
    patientUserId:
      d.patientUserId != null && Number.isFinite(Number(d.patientUserId))
        ? Number(d.patientUserId)
        : null,
    clinician: str(d.clinician),
    appointmentDateTime: str(d.appointmentDateTime),
    appointType: str(d.appointType),
    reason: str(d.reason),
    preferredDay: str(d.preferredDay) || null,
    preferredTime: str(d.preferredTime) || null,
    status,
    createdAt: str(d.createdAt),
    ...(str(d.newDateTime) ? { newDateTime: str(d.newDateTime) } : {}),
    ...(str(d.declineReason) ? { declineReason: str(d.declineReason) } : {}),
    ...(str(d.resolvedBy) ? { resolvedBy: str(d.resolvedBy) } : {}),
    ...(str(d.resolvedAt) ? { resolvedAt: str(d.resolvedAt) } : {}),
  };
}

/** Why a proposed new slot can't be used, or null if it is a sensible one. */
export function validateNewSlot(
  date: string,
  time: string,
  now = new Date(),
): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time))
    return "Choose a date and a time.";
  if (!isUpcomingAppointmentStrict(appointmentStart(date, time), now))
    return "That time has already passed. Choose a later time.";
  return null;
}

// ---- patient side ---------------------------------------------------------

export const MAX_REASON_LENGTH = 300;

export async function requestReschedule(input: {
  appointment: {
    docId: string;
    dateTime: string;
    type: string;
    clinician: string;
  };
  patientId: string;
  patientUserId?: number;
  reason: string;
  preferredDay?: string;
  preferredTime?: string;
}): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Not signed in");
  const id = `resched_${input.appointment.docId}_${Date.now()}`;
  await setDoc(doc(db, COLLECTION, id), {
    appointmentId: input.appointment.docId,
    patientId: input.patientId,
    // The signed-in account, so a patient's own requests can be listed (and
    // protected) by who they are, not by a value looked up from elsewhere.
    patientUid: uid,
    patientUserId: input.patientUserId ?? null,
    clinician: input.appointment.clinician,
    appointmentDateTime: input.appointment.dateTime,
    appointType: input.appointment.type,
    reason: input.reason.trim().slice(0, MAX_REASON_LENGTH),
    preferredDay: input.preferredDay || null,
    preferredTime: input.preferredTime || null,
    status: "pending",
    createdAt: new Date().toISOString(),
  });

  // Tell whoever has to answer it. Fire-and-forget: a failed notification must
  // never undo the request itself.
  const clinician = input.appointment.clinician;
  if (clinician) {
    const col = /^doc/i.test(clinician) ? "doctors" : "nurses";
    userIdForStaff(col, clinician)
      .then((staffUserId) => {
        if (staffUserId == null) return;
        return notifyUser({
          userId: staffUserId,
          title: "Reschedule requested",
          message: `${input.patientId} asked to move their ${input.appointment.type} appointment on ${appointmentDateTimeLabel(input.appointment.dateTime)}.`,
          // That day, with this appointment highlighted.
          link: `${col === "doctors" ? "/doctor/appointments" : "/nurse/appointments"}?date=${input.appointment.dateTime.slice(0, 10)}#appt-${input.appointment.docId}`,
        });
      })
      .catch((err) => console.error("Reschedule notification failed:", err));
  }
}

/** The patient taking their own pending request back. */
export async function withdrawReschedule(id: string): Promise<void> {
  await updateDoc(doc(db, COLLECTION, id), { status: "withdrawn" });
}

function useRequests(
  field: "patientUid" | "clinician",
  value: string | undefined,
) {
  const [items, setItems] = useState<RescheduleRequest[]>([]);
  useEffect(() => {
    if (!value) {
      setItems([]);
      return;
    }
    const unsub = onSnapshot(
      query(collection(db, COLLECTION), where(field, "==", value)),
      (snap) =>
        setItems(
          snap.docs
            .map((d) => fromDoc(d.id, d.data()))
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        ),
      (err) => console.error("Reschedule requests listener failed:", err),
    );
    return () => unsub();
  }, [field, value]);
  return items;
}

/** The signed-in patient's own requests, live (newest first). */
export function usePatientReschedules(): RescheduleRequest[] {
  const [uid, setUid] = useState<string | undefined>(
    () => auth.currentUser?.uid,
  );
  useEffect(
    () => onAuthStateChanged(auth, (u) => setUid(u?.uid ?? undefined)),
    [],
  );
  return useRequests("patientUid", uid);
}

/** Requests addressed to one clinician (Doc-1 / Nur-3), live (newest first). */
export function useClinicianReschedules(
  clinicianId: string | undefined,
): RescheduleRequest[] {
  return useRequests("clinician", clinicianId);
}

// ---- clinician side -------------------------------------------------------

/** Throws if this clinician is already booked at that exact moment (the check a new booking makes). */
async function assertSlotFree(
  clinician: string,
  wantedIso: string,
  exceptAppointmentId: string,
): Promise<void> {
  // The clash check reads the server; offline it would read a stale cache.
  assertOnline();
  const clash = await getDocs(
    query(
      collection(db, "appointments"),
      where("clinician", "==", clinician),
      where("appointDateTime", "==", wantedIso),
    ),
  );
  const taken = clash.docs.some((d) => {
    if (d.id === exceptAppointmentId) return false;
    const s = String(d.data().status ?? "").toLowerCase();
    return s !== "cancelled" && s !== "no-show";
  });
  if (taken)
    throw new Error(
      `${clinician} already has an appointment at that time. Choose a different time.`,
    );
}

/** What changes on an appointment when it is moved to a new time. */
function movedFields(current: Record<string, unknown>, wantedIso: string) {
  return {
    appointDateTime: wantedIso,
    // Back to unconfirmed: the patient hasn't agreed to the NEW time yet.
    status: "Scheduled",
    // The SMS/in-app reminders already sent were for the old time.
    reminderLog: [],
    reminderSentTo: deleteField(),
    rescheduledFrom: String(current.appointDateTime ?? ""),
    rescheduledAt: serverTimestamp(),
  };
}

/**
 * Accepts a request: moves the appointment to the new time, tells the patient.
 * Refuses a time in the past, or one where this clinician is already booked
 * (the same check a new booking makes), and refuses to answer a request that
 * someone else has already answered.
 */
export async function acceptReschedule(input: {
  request: RescheduleRequest;
  date: string;
  time: string;
  actorId: string;
}): Promise<void> {
  const { request, date, time, actorId } = input;
  const problem = validateNewSlot(date, time);
  if (problem) throw new Error(problem);

  const wanted = appointmentStart(date, time);
  await assertSlotFree(request.clinician, wanted, request.appointmentId);

  await runTransaction(db, async (tx) => {
    const reqRef = doc(db, COLLECTION, request.id);
    const apptRef = doc(db, "appointments", request.appointmentId);
    const [reqSnap, apptSnap] = await Promise.all([
      tx.get(reqRef),
      tx.get(apptRef),
    ]);
    if (!reqSnap.exists()) throw new Error("That request no longer exists.");
    if (reqSnap.data().status !== "pending")
      throw new Error("This request has already been answered.");
    if (!apptSnap.exists())
      throw new Error("The appointment no longer exists.");

    tx.update(apptRef, movedFields(apptSnap.data(), wanted));
    tx.update(reqRef, {
      status: "accepted",
      newDateTime: wanted,
      resolvedBy: actorId,
      resolvedAt: new Date().toISOString(),
    });
  });

  logAction({
    clinicId: null,
    actor_id: actorId,
    action_type: "appointment.reschedule",
    description: `${actorId} moved ${request.patientId}'s appointment #${request.appointmentId} from ${request.appointmentDateTime.slice(0, 16).replace("T", " ")} to ${date} ${time}`,
  });
  const userId = request.patientUserId;
  if (userId != null)
    notifyUser({
      userId,
      title: "Reschedule accepted",
      message: `Your ${request.appointType} appointment has moved to ${appointmentDateTimeLabel(wanted)}. Please confirm the new time.`,
      link: `/patient/appointments#appt-${request.appointmentId}`,
    }).catch((err) => console.error("Reschedule notification failed:", err));
}

/** Declines a request. The appointment stays exactly as it was. */
export async function declineReschedule(input: {
  request: RescheduleRequest;
  reason: string;
  actorId: string;
}): Promise<void> {
  const { request, reason, actorId } = input;
  await runTransaction(db, async (tx) => {
    const reqRef = doc(db, COLLECTION, request.id);
    const snap = await tx.get(reqRef);
    if (!snap.exists()) throw new Error("That request no longer exists.");
    if (snap.data().status !== "pending")
      throw new Error("This request has already been answered.");
    tx.update(reqRef, {
      status: "declined",
      declineReason: reason.trim().slice(0, MAX_REASON_LENGTH),
      resolvedBy: actorId,
      resolvedAt: new Date().toISOString(),
    });
  });
  const userId = request.patientUserId;
  if (userId != null)
    notifyUser({
      userId,
      title: "Reschedule declined",
      message: `Your request to move the ${request.appointType} appointment on ${appointmentDateTimeLabel(request.appointmentDateTime)} was declined${reason.trim() ? `: ${reason.trim()}` : "."} Your appointment stays as it was.`,
      link: `/patient/appointments#appt-${request.appointmentId}`,
    }).catch((err) => console.error("Reschedule notification failed:", err));
}

/**
 * A doctor or nurse moving an appointment themselves (for instance from the
 * "starts soon" prompt), without a patient's request. Same checks as accepting
 * one: not in the past, clinician not already booked. The patient is told and
 * must confirm the new time, and any reschedule request still open for this
 * appointment is closed as accepted, so it doesn't linger in the list.
 */
export async function moveAppointment(input: {
  appointmentId: string;
  clinician: string;
  patientId: string;
  appointType: string;
  fromDateTime: string;
  date: string;
  time: string;
  actorId: string;
}): Promise<void> {
  const { appointmentId, clinician, date, time, actorId } = input;
  const problem = validateNewSlot(date, time);
  if (problem) throw new Error(problem);
  const wanted = appointmentStart(date, time);
  await assertSlotFree(clinician, wanted, appointmentId);

  await runTransaction(db, async (tx) => {
    const apptRef = doc(db, "appointments", appointmentId);
    const snap = await tx.get(apptRef);
    if (!snap.exists()) throw new Error("The appointment no longer exists.");
    tx.update(apptRef, movedFields(snap.data(), wanted));
  });

  logAction({
    clinicId: null,
    actor_id: actorId,
    action_type: "appointment.reschedule",
    description: `${actorId} moved ${input.patientId}'s appointment #${appointmentId} from ${input.fromDateTime.slice(0, 16).replace("T", " ")} to ${date} ${time}`,
  });

  // Close any open request for this appointment (best effort).
  getDocs(
    query(collection(db, COLLECTION), where("clinician", "==", clinician)),
  )
    .then((snap) =>
      Promise.all(
        snap.docs
          .filter(
            (d) =>
              d.data().appointmentId === appointmentId &&
              d.data().status === "pending",
          )
          .map((d) =>
            updateDoc(d.ref, {
              status: "accepted",
              newDateTime: wanted,
              resolvedBy: actorId,
              resolvedAt: new Date().toISOString(),
            }),
          ),
      ),
    )
    .catch((err) => console.error("Couldn't close the open request:", err));

  // Tell the patient (fire-and-forget).
  getDoc(doc(db, "patients", input.patientId))
    .then((p) => {
      const userId = Number(p.data()?.userId);
      if (!p.exists() || !Number.isFinite(userId)) return;
      return notifyUser({
        userId,
        title: "Appointment moved",
        message: `Your ${input.appointType} appointment has moved to ${appointmentDateTimeLabel(wanted)}. Please confirm the new time.`,
        link: `/patient/appointments#appt-${appointmentId}`,
      });
    })
    .catch((err) => console.error("Move notification failed:", err));
}

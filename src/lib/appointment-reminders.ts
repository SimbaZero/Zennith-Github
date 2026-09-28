import { addDoc, collection, doc, getDoc, getDocs, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { buildAppointmentReminderText, formatPhoneForSms, sendSms } from "@/lib/smsportal";

export type AppointmentReminderKind = "day-before-18:00" | "day-before-20:00" | "morning-08:00";

export interface AppointmentReminderTarget {
  kind: AppointmentReminderKind;
  scheduledFor: Date;
  message: string;
}

function appointmentDateValue(appointmentDateTime: string): Date {
  const value = new Date(appointmentDateTime);
  return Number.isNaN(value.getTime()) ? new Date() : value;
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

export function getReminderTargetsForAppointment(
  appointmentDateTime: string,
  clinician = "your clinic team",
): AppointmentReminderTarget[] {
  const start = appointmentDateValue(appointmentDateTime);
  const appointmentDate = new Date(start);
  const dayBefore = new Date(appointmentDate);
  dayBefore.setDate(dayBefore.getDate() - 1);

  const slots: Array<{ kind: AppointmentReminderKind; at: Date }> = [
    { kind: "day-before-18:00", at: new Date(dayBefore.getFullYear(), dayBefore.getMonth(), dayBefore.getDate(), 18, 0, 0) },
    { kind: "day-before-20:00", at: new Date(dayBefore.getFullYear(), dayBefore.getMonth(), dayBefore.getDate(), 20, 0, 0) },
    { kind: "morning-08:00", at: new Date(appointmentDate.getFullYear(), appointmentDate.getMonth(), appointmentDate.getDate(), 8, 0, 0) },
  ];

  const date = start.toISOString().slice(0, 10);
  const time = start.toISOString().slice(11, 16);

  return slots.map((slot) => ({
    kind: slot.kind,
    scheduledFor: slot.at,
    message: buildAppointmentReminderText({
      appointmentDate: date,
      appointmentTime: time,
      clinician,
      isMorningReply: slot.kind === "morning-08:00",
    }),
  }));
}

async function getPatientContactNumber(patientId: string): Promise<string | null> {
  const patientSnap = await getDoc(doc(db, "patients", patientId));
  if (!patientSnap.exists()) return null;
  const patient = patientSnap.data();
  const userId = patient.userId;
  if (userId == null) return null;
  const userSnap = await getDoc(doc(db, "users", String(userId)));
  if (!userSnap.exists()) return null;
  return String(userSnap.data().contactNum ?? "");
}

async function queueAppNotification({
  userId,
  title,
  message,
}: {
  userId: number;
  title: string;
  message: string;
}) {
  await addDoc(collection(db, "notifications"), {
    userId,
    title,
    message,
    isRead: false,
    timeSent: new Date().toISOString(),
    source: "sms-reminder",
  });
}

export async function processDueAppointmentReminders(now = new Date()) {
  const appointmentsSnap = await getDocs(collection(db, "appointments"));
  const results: Array<{ appointmentId: string; kind: AppointmentReminderKind; sent: boolean; reason?: string }> = [];

  for (const appointmentDoc of appointmentsSnap.docs) {
    const appointment = appointmentDoc.data();
    if (!appointment.appointDateTime || typeof appointment.appointDateTime !== "string") continue;
    if (["Cancelled", "Confirmed", "Completed"].includes(String(appointment.status ?? ""))) continue;

    const appointmentDateTime = new Date(appointment.appointDateTime);
    if (Number.isNaN(appointmentDateTime.getTime())) continue;

    const patientId = appointment.patientId;
    if (!patientId) continue;

    const reminderLog: string[] = Array.isArray(appointment.reminderLog) ? appointment.reminderLog : [];
    const clinician = String(appointment.clinician ?? "your clinic team");
    const targets = getReminderTargetsForAppointment(appointment.appointDateTime, clinician);

    for (const target of targets) {
      const isDue = now >= target.scheduledFor && now <= addMinutes(target.scheduledFor, 30);
      if (!isDue || reminderLog.includes(target.kind)) continue;

      const phone = await getPatientContactNumber(patientId);
      if (!phone) {
        results.push({ appointmentId: appointmentDoc.id, kind: target.kind, sent: false, reason: "missing-phone" });
        continue;
      }

      const sent = await sendSms({
        to: phone,
        message: target.message,
        testMode: false,
      });

      if (!sent.ok) {
        results.push({ appointmentId: appointmentDoc.id, kind: target.kind, sent: false, reason: sent.reason });
        continue;
      }

      const patientSnap = await getDoc(doc(db, "patients", patientId));
      if (patientSnap.exists()) {
        const patient = patientSnap.data();
        const userId = Number(patient.userId ?? 0);
        if (userId) {
          await queueAppNotification({
            userId,
            title: "Appointment reminder",
            message: target.message,
          });
        }
      }

      await updateDoc(doc(db, "appointments", appointmentDoc.id), {
        reminderLog: Array.from(new Set([...reminderLog, target.kind])),
      });

      results.push({ appointmentId: appointmentDoc.id, kind: target.kind, sent: true });
    }
  }

  return results;
}

export function appointmentReminderTypesForDate(date: string, time: string): AppointmentReminderKind[] {
  const appointmentDate = new Date(`${date}T${time}:00`);
  const dayBefore = new Date(appointmentDate);
  dayBefore.setDate(dayBefore.getDate() - 1);
  const morning = new Date(appointmentDate);
  morning.setHours(8, 0, 0, 0);

  const byDate = [
    { type: "day-before-18:00" as const, at: new Date(dayBefore.getFullYear(), dayBefore.getMonth(), dayBefore.getDate(), 18, 0, 0) },
    { type: "day-before-20:00" as const, at: new Date(dayBefore.getFullYear(), dayBefore.getMonth(), dayBefore.getDate(), 20, 0, 0) },
    { type: "morning-08:00" as const, at: new Date(morning) },
  ];

  return byDate.map((slot) => slot.type);
}

export function getPatientPhoneCandidates(value: string): string[] {
  const normalized = formatPhoneForSms(value);
  if (!normalized) return [];
  return [normalized, normalized.replace(/^\+27/, "0"), normalized.replace(/^\+/, "")];
}

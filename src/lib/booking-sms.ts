import { createServerFn } from "@tanstack/react-start";

// The text a patient gets when an appointment is booked: the server function
// createAppointment calls after writing the appointment. The work happens in
// src/server/booking-sms.ts, loaded inside the handler so none of it (or the
// service-account code it uses) ends up in the browser bundle.

export type BookingSmsFailure =
  | "not-configured"
  | "unauthenticated"
  | "not-allowed"
  | "not-found"
  | "already-sent"
  | "not-eligible"
  | "no-phone"
  | "rate-limited"
  | "busy"
  | "send-failed";

export type BookingSmsResult = { sent: true } | { sent: false; reason: BookingSmsFailure };

export const textBookingConfirmation = createServerFn({ method: "POST" })
  .inputValidator((d: { idToken: string; appointmentId: string }) => d)
  .handler(async ({ data }): Promise<BookingSmsResult> => {
    const { sendBookingSms } = await import("../server/booking-sms");
    return sendBookingSms(data?.idToken, data?.appointmentId);
  });

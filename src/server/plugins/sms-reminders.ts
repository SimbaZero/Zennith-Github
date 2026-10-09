// Nitro runtime plugin: connects the Worker's cron triggers (wrangler.json)
// to the appointment reminder job.
//
// Nitro builds the deployed Worker entry, and its scheduled() export only
// fires the "cloudflare:scheduled" hook. A scheduled() on src/server.ts is
// never called, so the job has to be registered here. Registered in
// nitro.config.ts.
import { definePlugin } from "nitro";
import { useNitroHooks } from "nitro/app";
import {
  HOUR_BEFORE_CRON,
  processDueAppointmentReminders,
  processHourBeforeNotifications,
} from "../../lib/appointment-reminders";

export default definePlugin(() => {
  useNitroHooks().hook("cloudflare:scheduled", async ({ controller, env }) => {
    // The time the cron was due, not when this run started, so a slow start
    // can't push a reminder outside its window.
    const firedAt = new Date(controller.scheduledTime);
    try {
      // The frequent trigger only does the in-app hour-before notifications; the
      // three daily triggers only do the SMS reminders. Keeping them apart means
      // two jobs never run at the same minute and double-send.
      if (controller.cron === HOUR_BEFORE_CRON) {
        const results = await processHourBeforeNotifications(firedAt, env);
        const sent = results.filter((r) => r.sent).length;
        if (results.length) console.info(`[hour-before] cron ${controller.cron}: ${sent} sent, ${results.length - sent} not sent`);
        return;
      }
      const results = await processDueAppointmentReminders(firedAt, env);
      const sent = results.filter((r) => r.sent).length;
      console.info(`[sms-reminders] cron ${controller.cron}: ${sent} sent, ${results.length - sent} not sent`);
    } catch (error) {
      console.error(`[sms-reminders] cron ${controller.cron} failed:`, error);
    }
  });
});

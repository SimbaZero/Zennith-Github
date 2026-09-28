// Nitro reads this alongside the options @lovable.dev/vite-tanstack-config
// passes it (that wrapper's typed `nitro` option has no `plugins` field).
import { defineConfig } from "nitro";

export default defineConfig({
  // Nitro builds the deployed Worker entry and owns its scheduled() export;
  // this plugin connects the wrangler.json crons to the SMS reminder job.
  plugins: ["./src/server/plugins/sms-reminders.ts"],
});

import { createServerFn } from "@tanstack/react-start";

// "Which admins look after this clinic?", answered by the server. The work is in
// src/server/clinic-admins.ts, loaded inside the handler so none of it (or the
// service-account code it uses) ends up in the browser bundle. See that file
// for why this isn't a direct Firestore read.

export type ClinicAdminsResult =
  | { ok: true; adminIds: string[] }
  | {
      ok: false;
      reason: "not-configured" | "unauthenticated" | "not-eligible";
    };

export const getClinicAdminIds = createServerFn({ method: "POST" })
  .inputValidator((d: { idToken: string; clinicId: number }) => d)
  .handler(async ({ data }): Promise<ClinicAdminsResult> => {
    const { findClinicAdminIds } = await import("../server/clinic-admins");
    return findClinicAdminIds(data?.idToken, data?.clinicId);
  });

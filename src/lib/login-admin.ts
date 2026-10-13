import { createServerFn } from "@tanstack/react-start";

// Removing a sign-in account (Firebase Auth) for real.
//
// Revoking someone's access in the app deletes their profile, which is what
// stops them using it - but a browser cannot delete another person's Firebase
// Auth account, so the account itself used to be left behind, still holding the
// e-mail address. Re-granting that address then failed with "already has an
// account". The server can delete it (as the service account), so it does:
//   - right after a revoke (`uid`: the profile that was just removed), and
//   - as a safety net when an admin creates a login and the address turns out
//     to belong to a leftover account that has no profile (`email`).
// The work is in src/server/login-admin.ts, loaded inside the handler so none
// of it reaches the browser bundle.

export type ReleaseLoginResult =
  | { ok: true; deleted: boolean }
  | {
      ok: false;
      reason:
        | "not-configured"
        | "unauthenticated"
        | "not-eligible"
        | "still-in-use"
        | "too-new"
        | "self"
        | "lookup-failed"
        | "server-error";
    };

export const releaseLoginAccount = createServerFn({ method: "POST" })
  .inputValidator((d: { idToken: string; uid?: string; email?: string }) => d)
  .handler(async ({ data }): Promise<ReleaseLoginResult> => {
    try {
      const { releaseLogin } = await import("../server/login-admin");
      return await releaseLogin({
        idToken: data?.idToken,
        uid: data?.uid,
        email: data?.email,
      });
    } catch (error) {
      console.error("[login-admin] release failed:", error);
      return { ok: false, reason: "server-error" };
    }
  });

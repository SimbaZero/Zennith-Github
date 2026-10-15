import { createServerFn } from "@tanstack/react-start";

// The sign-in box's server call: see src/server/login-lookup.ts for what it
// does and why. The work is loaded inside the handler so none of the
// service-account code ends up in the browser bundle.

export const resolveLoginCandidates = createServerFn({ method: "POST" })
  .inputValidator((d: { identifier: string }) => d)
  .handler(
    async ({ data }): Promise<{ candidates: string[]; resolved: boolean }> => {
      const { lookUpLoginCandidates } = await import("../server/login-lookup");
      return lookUpLoginCandidates(data?.identifier);
    },
  );

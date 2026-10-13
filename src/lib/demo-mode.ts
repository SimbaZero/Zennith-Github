import { createServerFn } from "@tanstack/react-start";

// Demo mode: whether the two-factor screen offers a "Skip (demo mode)" button,
// for presentations where nobody wants to wait for a text message.
//
// Decided by the SERVER, at request time, from the DEMO_MODE environment
// variable - not baked into the browser bundle. That is deliberate:
//   - nothing in a built bundle can switch it on, so a stray .env on the
//     machine that builds the deployed site can't leak it into production;
//   - it is off unless the variable is exactly "true" (unset, empty, "false",
//     "1", "TRUE" are all off), and the answer is "off" whenever the server
//     can't be asked;
//   - the skip button asks again when it is pressed, so it also stops working
//     the moment the flag is turned off.
//
// NEVER set DEMO_MODE in production. It skips the second factor for anyone who
// has passed the password step (the password itself is still checked by Firebase
// Auth, and roles/clinic still come from the signed-in user's own profile).

/** Only the exact string "true" turns demo mode on. */
export function demoModeEnabled(raw: string | undefined | null): boolean {
  return raw === "true";
}

export interface DemoModeState {
  enabled: boolean;
}

export const getDemoMode = createServerFn({ method: "GET" }).handler(
  async (): Promise<DemoModeState> => {
    try {
      const { readEnv } = await import("../server/env");
      return { enabled: demoModeEnabled(readEnv(undefined, "DEMO_MODE")) };
    } catch (error) {
      console.error(
        "[demo-mode] couldn't read the flag; treating as off:",
        error,
      );
      return { enabled: false };
    }
  },
);

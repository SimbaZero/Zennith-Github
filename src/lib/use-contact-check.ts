import { useEffect, useState } from "react";
import {
  checkContactInUse,
  type ContactCheckResult,
} from "@/lib/contact-check";
import { emailKey, phoneKey } from "@/lib/contact-key";

export type ContactCheckState =
  /** Nothing typed that's worth checking yet. */
  | { status: "idle" }
  | { status: "checking" }
  | { status: "done"; result: ContactCheckResult }
  /** The database couldn't be reached; no claim either way. */
  | { status: "unavailable" };

const DEBOUNCE_MS = 450;

/**
 * Checks an e-mail and phone numbers against existing patients as they're typed.
 * Waits for a pause in typing, ignores answers to values that have since
 * changed, and never reports "in use" for something it couldn't check.
 */
export function useContactCheck(
  email: string,
  phones: string[],
  excludeUserId?: string | number | null,
): ContactCheckState {
  const [state, setState] = useState<ContactCheckState>({ status: "idle" });
  // A stable identity for the effect: re-run only when what's typed changes.
  const key = JSON.stringify([
    emailKey(email),
    phones.map(phoneKey),
    excludeUserId ?? null,
  ]);
  const worthChecking = !!emailKey(email) || phones.some((p) => !!phoneKey(p));

  useEffect(() => {
    if (!worthChecking) {
      setState({ status: "idle" });
      return;
    }
    let current = true;
    setState({ status: "checking" });
    const timer = setTimeout(() => {
      checkContactInUse({ email, phones, excludeUserId })
        .then((result) => current && setState({ status: "done", result }))
        .catch((error) => {
          console.warn("Contact check unavailable:", error);
          if (current) setState({ status: "unavailable" });
        });
    }, DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
    // `key` stands in for email/phones/excludeUserId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, worthChecking]);

  return state;
}

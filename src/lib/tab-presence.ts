import { useEffect } from "react";

// Is the same account open in another tab of this browser?
//
// Each tab writes a small heartbeat to localStorage (its own key, so tabs never
// overwrite each other); any tab can then count the recent heartbeats from
// OTHER tabs for the same account. Nothing leaves the browser.
//
// Its job is narrow: when something looks like "you're offline", the app can
// check whether a second tab for this account is open and say THAT, instead of
// a connection message that isn't true. It does not block or sign anyone out -
// staff legitimately keep more than one page open.

const PREFIX = "zennith:tab:";
const BEAT_MS = 4_000;
/**
 * A tab that hasn't beaten for this long is treated as closed. Generous on
 * purpose: a tab left in the background is throttled by the browser (after about
 * five minutes its timers fire roughly once a minute), and the OTHER tab is very
 * often exactly that hidden one. Too short a limit would call it closed.
 */
export const STALE_MS = 150_000;
/** Entries older than this are junk from a tab that crashed; only then are they removed. */
const JUNK_MS = 60 * 60_000;

const tabId =
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : String(Math.random()).slice(2);

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null; // storage blocked: presence simply can't be known
  }
}

/**
 * How many OTHER tabs have recently reported being signed in as `uid`. Zero when
 * `uid` is unknown or storage is unavailable.
 */
export function otherTabsForAccount(
  uid: string | null | undefined,
  now = Date.now(),
): number {
  const ls = storage();
  if (!ls || !uid) return 0;
  let n = 0;
  try {
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (!k || !k.startsWith(PREFIX) || k === PREFIX + tabId) continue;
      const v = JSON.parse(ls.getItem(k) ?? "null") as {
        uid?: string;
        t?: number;
      } | null;
      if (!v || typeof v.t !== "number") continue;
      if (now - v.t >= JUNK_MS) {
        ls.removeItem(k); // a tab that crashed without saying so, long ago
        continue;
      }
      if (now - v.t >= STALE_MS) continue; // probably closed; leave it to its owner
      if (v.uid === uid) n++;
    }
  } catch {
    return 0;
  }
  return n;
}

let started = 0;
let stop: (() => void) | null = null;

/** Starts this tab's heartbeat (shared by every caller); returns a stopper. */
export function startTabPresence(
  getUid: () => string | null | undefined,
): () => void {
  started++;
  if (started === 1) {
    const ls = storage();
    const beat = () => {
      if (!ls) return;
      const uid = getUid();
      try {
        if (uid)
          ls.setItem(PREFIX + tabId, JSON.stringify({ uid, t: Date.now() }));
        else ls.removeItem(PREFIX + tabId);
      } catch {
        /* storage full or blocked: nothing to do */
      }
    };
    beat();
    const id = setInterval(beat, BEAT_MS);
    const leave = () => {
      try {
        ls?.removeItem(PREFIX + tabId);
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("pagehide", leave);
    stop = () => {
      clearInterval(id);
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }
  return () => {
    started = Math.max(0, started - 1);
    if (started === 0 && stop) {
      stop();
      stop = null;
    }
  };
}

/** Keeps this tab's heartbeat running while signed in. Call once, from the shell. */
export function useTabPresence(getUid: () => string | null | undefined): void {
  useEffect(() => startTabPresence(getUid), []); // eslint-disable-line react-hooks/exhaustive-deps
}

/** The message shown instead of an "offline" one when a second tab is the likely reason. */
export const DUPLICATE_TAB_MESSAGE =
  "This account is already signed in in another tab — switch to that tab or sign out there first.";

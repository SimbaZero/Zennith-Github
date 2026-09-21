import { useEffect, useState } from "react";
import {
  runTransaction,
  type Firestore,
  type Transaction,
} from "firebase/firestore";

export function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    setOnline(typeof navigator !== "undefined" ? navigator.onLine : true);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}

export function loadLS<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
export function saveLS<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

/** Client-only mount flag — use to avoid SSR/CSR hydration mismatch for time. */
export function useMounted() {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}

// ---------------------------------------------------------------------------
// Transactions and offline.
//
// Firestore's offline cache lets ordinary reads and writes keep working
// without a connection — writes queue locally and sync when it returns. A
// TRANSACTION is different: it has to read the current value from the server
// and commit atomically, which is the whole point of using one (two nurses
// can't both dispense the last box; two signups can't get the same ID). So
// transactions genuinely cannot run offline.
//
// Left alone, an offline transaction fails with Firebase's generic
// "unavailable" error, which reaches the user as a vague "something went
// wrong". This fails fast with a message that says what actually happened
// and that nothing was saved.
// ---------------------------------------------------------------------------

export function runTransactionOnline<T>(
  db: Firestore,
  update: (tx: Transaction) => Promise<T>,
): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return Promise.reject(
      new Error(
        "You're offline. This has to be confirmed with the server, so it " +
          "can't be done without a connection — nothing was saved. " +
          "Reconnect and try again.",
      ),
    );
  }
  return runTransaction(db, update);
}

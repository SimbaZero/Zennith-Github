import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "@/firebase";
import { registerSessionCache } from "@/lib/session-caches";

// The name the sidebar shows for whoever is signed in — one source, one rule,
// for every role and every page.
//
// The source is `fullName` on the person's own profile document
// (profiles/{uid}), which every kind of account has.
//
// Before this, each page passed its OWN idea of the name to AppShell: nurses,
// doctors and pharmacists from their `users` record (falling back to a staff ID
// like "Nur-1"), receptionists from the profile (falling back to "Receptionist"),
// admins from the profile (falling back to the login username, sometimes an
// email), and patients and a few pages from nothing at all. Every one of those
// is `undefined` until its own lookup lands, so each page opened on a generic
// fallback and then flipped — and the same person was shown differently from
// page to page.
//
// The name is read once per session and remembered (and forgotten on sign-out —
// see session-caches.ts), so moving between pages gives the same answer
// instantly rather than looking it up again.

// Settled results, readable synchronously: a string, or null when the profile
// has no usable name (which is a real answer, not "not loaded yet").
const nameByUid = new Map<string, string | null>();
const lookupByUid = new Map<string, Promise<void>>();
registerSessionCache(() => {
  nameByUid.clear();
  lookupByUid.clear();
});

/** A real name, or null. An email address is an identifier, never a name. */
function usableName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return v && !v.includes("@") ? v : null;
}

function lookUp(uid: string): Promise<void> {
  let p = lookupByUid.get(uid);
  if (!p) {
    p = getDoc(doc(db, "profiles", uid)).then((snap) => {
      nameByUid.set(
        uid,
        usableName(snap.exists() ? snap.data().fullName : null),
      );
    });
    lookupByUid.set(uid, p);
    // A failed read must not be remembered as "this person has no name".
    p.catch(() => lookupByUid.delete(uid));
  }
  return p;
}

export function useSignedInName(): { name: string | null; loading: boolean } {
  // `undefined` = Firebase hasn't said who is signed in yet; `null` = nobody is.
  // On the server there is no signed-in user, and the first browser render has to
  // match it — but on a later in-app navigation the user is already known, and
  // starting from them is what lets the remembered name show with no flash.
  const [uid, setUid] = useState<string | null | undefined>(() =>
    typeof window === "undefined"
      ? undefined
      : (auth.currentUser?.uid ?? undefined),
  );
  const [, refresh] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(
    () => onAuthStateChanged(auth, (user) => setUid(user?.uid ?? null)),
    [],
  );

  useEffect(() => {
    if (!uid || nameByUid.has(uid)) return;
    let cancelled = false;
    setFailed(false);
    lookUp(uid)
      .then(() => {
        if (!cancelled) refresh((n) => n + 1);
      })
      .catch((err) => {
        console.error("Couldn't read the signed-in user's name:", err);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [uid]);

  const settled = uid ? nameByUid.has(uid) : false;
  return {
    name: uid && settled ? (nameByUid.get(uid) ?? null) : null,
    loading: uid === undefined || (uid !== null && !settled && !failed),
  };
}

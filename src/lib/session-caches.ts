// A register of everything the app remembers about WHO is signed in or WHO a
// patient/clinician is, so that all of it can be forgotten when the session ends.
//
// Several services keep module-level caches (the signed-in doctor's profile,
// patients' names, which clinic a pharmacist is looking at…). A module lives as
// long as the browser tab does, not as long as a login — so without this the next
// person to sign in on the same tab could be handed the previous person's
// identity, or a name that has since changed, from a cache that was never emptied.
//
// Each service registers its own clearer when it loads (registerSessionCache),
// and signing out / starting a session calls clearSessionCaches(). It is a
// register rather than auth.ts importing the services directly because the login
// page imports auth.ts: direct imports would pull the doctor, nurse, pharmacist
// and patient services into that bundle just to empty their caches. A service
// that hasn't been loaded has nothing cached, so it needs no clearing.
//
// This file imports nothing, on purpose, so anything can depend on it.

const clearers = new Set<() => void>();

/** Call at module load with a function that empties that module's caches. */
export function registerSessionCache(clear: () => void): void {
  clearers.add(clear);
}

/** Forget everything registered. One failing clearer must not stop the rest. */
export function clearSessionCaches(): void {
  for (const clear of clearers) {
    try {
      clear();
    } catch (err) {
      console.error("Clearing a session cache failed:", err);
    }
  }
}

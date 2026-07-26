// Compatibility re-export.
//
// Firebase is initialised once in `src/firebase.ts` from the VITE_FIREBASE_*
// environment variables (see .env.example). This module previously initialised a
// second app with the config hardcoded in source; it now forwards to the shared
// instance so there is a single app, a single config source, and no credentials
// committed to the repo.
//
// Prefer importing from "@/firebase" in new code.
export { auth, db, firebaseConfig, default as app } from "@/firebase";

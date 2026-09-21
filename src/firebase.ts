import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from "firebase/firestore";

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);

/**
 * Firestore with offline support.
 *
 * By default Firestore keeps data only in memory, so losing the connection —
 * or refreshing the page — meant losing everything on screen. This stores a
 * copy of everything the app has loaded in the browser's own database
 * (IndexedDB), so:
 *
 *   - pages you've already opened keep working from that copy when offline
 *   - changes made offline are queued and sent automatically on reconnect
 *   - live lists keep updating from the local copy in the meantime
 *
 * The multi-tab manager lets several tabs share one cache, which matters
 * because staff routinely keep more than one page open.
 *
 * Two cases fall back to the plain in-memory setup:
 *   - on the SERVER (this app renders pages server-side first), where there
 *     is no browser storage at all
 *   - when Firestore was already started, which happens during development
 *     hot-reloads; reusing the existing instance avoids a crash
 */
function createDb(): Firestore {
  if (typeof window === "undefined") return getFirestore(app);
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    });
  } catch {
    return getFirestore(app);
  }
}

export const db = createDb();
export default app;

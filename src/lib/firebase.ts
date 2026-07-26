import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyBG84S9VAN7qgBHBa--CErDO5kUEATtTag",
  authDomain: "zennith-d6faa.firebaseapp.com",
  projectId: "zennith-d6faa",
  storageBucket: "zennith-d6faa.firebasestorage.app",
  messagingSenderId: "229481842170",
  appId: "1:229481842170:web:7ce9c40d0dd2b1c4571043",
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);

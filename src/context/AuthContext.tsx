import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { onAuthStateChanged, signOut as fbSignOut, type User } from "firebase/auth";
import { auth } from "@/firebase";
import { clearAuth, getAuth as getStoredRole, type Role } from "@/lib/auth";

type AuthContextValue = {
  user: User | null;      // the Firebase user (null until Firebase login is wired in)
  role: Role | null;      // still comes from localStorage for now
  loading: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // listens for Firebase sign-in/sign-out events
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setRole(getStoredRole()); // role still read from your existing mock system
      setLoading(false);
    });
    return unsub;
  }, []);

  const signOut = async () => {
    await fbSignOut(auth).catch(() => {});
    clearAuth();
    setUser(null);
    setRole(null);
  };

  return (
    <AuthContext.Provider value={{ user, role, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
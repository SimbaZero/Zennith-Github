import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  updateDoc,
  where,
} from "firebase/firestore";
import { useEffect, useState } from "react";
import { db } from "@/lib/firebase";

// One notification system for every role.
//
// The `notifications` collection was always generic — keyed on the numeric
// users.userId, which every role has. Only Patients were ever wired up to it;
// staff bells rendered a hardcoded fake list. This makes all five real.
//
// `link` lets a notification deep-link to the page where the user can act on
// it, so a notification is a way in rather than just an announcement.

export interface AppNotification {
  docId: string;
  title: string;
  message: string;
  timeSent: string;
  isRead: boolean;
  link?: string;
}

/** Live notifications for any user, any role. */
export function useNotifications(userId?: number | null): AppNotification[] {
  const [items, setItems] = useState<AppNotification[]>([]);

  useEffect(() => {
    if (userId == null) {
      setItems([]);
      return;
    }
    const q = query(
      collection(db, "notifications"),
      where("userId", "==", userId),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setItems(
          snap.docs
            .map((d) => {
              const n = d.data();
              return {
                docId: d.id,
                title: n.title ?? "",
                message: n.message ?? "",
                timeSent: n.timeSent ?? "",
                isRead: !!n.isRead,
                link: n.link,
              };
            })
            .sort((a, b) => b.timeSent.localeCompare(a.timeSent)),
        );
      },
      (err) => console.error("Notifications subscription failed:", err),
    );
    return () => unsub();
  }, [userId]);

  return items;
}

/** Send to one user by numeric userId. */
export async function notifyUser(input: {
  userId: number;
  title: string;
  message: string;
  link?: string;
}): Promise<void> {
  await addDoc(collection(db, "notifications"), {
    notifId: Date.now(),
    userId: input.userId,
    title: input.title,
    message: input.message,
    isRead: false,
    timeSent: new Date().toISOString(),
    ...(input.link ? { link: input.link } : {}),
  });
}

/**
 * Send to every staff member of a role at a clinic — e.g. "stock arriving"
 * goes to all nurses there, since any of them can receive it. Fire-and-forget:
 * a failed notification must never break the action that triggered it.
 */
export async function notifyRoleAtClinic(input: {
  role: "nurses" | "doctors" | "pharmacists" | "receptionists";
  clinicId: number;
  title: string;
  message: string;
  link?: string;
}): Promise<void> {
  try {
    // Doctors and pharmacists can serve several clinics (clinicIds), the
    // others belong to one (clinicId) — so check both.
    const [single, multi] = await Promise.all([
      getDocs(
        query(
          collection(db, input.role),
          where("clinicId", "==", input.clinicId),
        ),
      ),
      getDocs(
        query(
          collection(db, input.role),
          where("clinicIds", "array-contains", input.clinicId),
        ),
      ).catch(() => ({ docs: [] as any[] })),
    ]);

    const userIds = new Set<number>();
    for (const d of [...single.docs, ...multi.docs]) {
      const uid = Number(d.data().userId);
      if (Number.isFinite(uid)) userIds.add(uid);
    }

    await Promise.all(
      [...userIds].map((userId) =>
        notifyUser({
          userId,
          title: input.title,
          message: input.message,
          link: input.link,
        }),
      ),
    );
  } catch (err) {
    console.error("notifyRoleAtClinic failed:", err);
  }
}

/** Resolve a staff member's numeric userId from their role-specific ID. */
export async function userIdForStaff(
  collectionName: "nurses" | "doctors" | "pharmacists" | "receptionists",
  staffId: string,
): Promise<number | null> {
  const snap = await getDoc(doc(db, collectionName, staffId));
  if (!snap.exists()) return null;
  const uid = Number(snap.data().userId);
  return Number.isFinite(uid) ? uid : null;
}

export async function markRead(docId: string): Promise<void> {
  await updateDoc(doc(db, "notifications", docId), { isRead: true });
}

export async function markAllRead(docIds: string[]): Promise<void> {
  await Promise.all(docIds.map((id) => markRead(id)));
}

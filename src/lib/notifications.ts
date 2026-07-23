import type { Role } from "./auth";

export interface Notification {
  title: string;
  body: string;
  time: string;
  unread: boolean;
}

const data: Record<Role, Notification[]> = {
  nurse: [
    { title: "New appointment", body: "Thandi Mokoena scheduled for 09:00.", time: "10m ago", unread: true },
    { title: "Stock delivered", body: "TLD batch received from pharmacy.", time: "1h ago", unread: true },
    { title: "Follow-up due", body: "5 patients pending follow-up scheduling.", time: "3h ago", unread: false },
  ],
  doctor: [
    { title: "Lab result ready", body: "Viral load result for P-0481 available.", time: "20m ago", unread: true },
    { title: "Schedule update", body: "Naledi Tshabalala moved to 10:30.", time: "2h ago", unread: false },
  ],
  patient: [
    { title: "Medication ready", body: "TLD ready for collection at Hilbrow CHC.", time: "2h ago", unread: true },
    { title: "Appointment reminder", body: "Apr 27 · 09:00 with Dr. Mutizwa.", time: "1d ago", unread: true },
  ],
  pharmacist: [
    { title: "Stock alert", body: "Rifafour is out of stock — reorder needed.", time: "5m ago", unread: true },
    { title: "Low stock", body: "Efavirenz 600mg below threshold.", time: "1h ago", unread: true },
    { title: "Distribution complete", body: "148 units sent to nursing team.", time: "4h ago", unread: false },
  ],
  receptionist: [
    { title: "Incomplete profile", body: "Thandi Mokoena · missing address & contact.", time: "15m ago", unread: true },
    { title: "Incomplete profile", body: "Sipho Dlamini · missing emergency contact.", time: "30m ago", unread: true },
    { title: "New registration", body: "Lindiwe Mahlangu has been registered.", time: "2h ago", unread: true },
  ],
  admin: [],
  super_admin: [],
};

export function getNotifications(role: Role): Notification[] {
  return data[role] ?? [];
}

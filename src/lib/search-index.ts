import type { Role } from "./auth";

export interface SearchEntry {
  label: string;
  section: string;
  path: string;
  hash?: string;
  keywords: string[];
}

const nurseIndex: SearchEntry[] = [
  {
    label: "Dashboard",
    section: "Nurse · Overview",
    path: "/nurse",
    keywords: ["home", "stats", "overview"],
  },
  {
    label: "Appointments",
    section: "Nurse",
    path: "/nurse/appointments",
    keywords: ["schedule", "booking", "today"],
  },
  {
    label: "Digitize Files",
    section: "Nurse",
    path: "/nurse/digitize",
    keywords: ["scan", "ocr", "upload", "file"],
  },
  {
    label: "Patients",
    section: "Nurse",
    path: "/nurse/patients",
    keywords: ["records", "people", "list"],
  },
];

const doctorIndex: SearchEntry[] = [
  {
    label: "Dashboard",
    section: "Doctor · Overview",
    path: "/doctor",
    keywords: ["home", "overview"],
  },
  {
    label: "Appointments",
    section: "Doctor",
    path: "/doctor/appointments",
    keywords: ["bookings", "today"],
  },
  {
    label: "Patient Files",
    section: "Doctor",
    path: "/doctor/patients",
    keywords: ["records", "people"],
  },
];

const patientIndex: SearchEntry[] = [
  {
    label: "Dashboard",
    section: "Patient · Overview",
    path: "/patient",
    keywords: ["home"],
  },
  {
    label: "Medical Record",
    section: "Patient",
    path: "/patient/medical-record",
    keywords: ["history", "diagnosis", "medication"],
  },
  {
    label: "Appointments",
    section: "Patient",
    path: "/patient/appointments",
    keywords: ["doctor", "visits"],
  },
  {
    label: "Alerts",
    section: "Patient",
    path: "/patient/alerts",
    keywords: ["notifications", "stock", "reminders"],
  },
];

const pharmacistIndex: SearchEntry[] = [
  {
    label: "Dashboard",
    section: "Pharmacy · Overview",
    path: "/pharmacist",
    keywords: ["home"],
  },
  {
    label: "Stock Levels",
    section: "Pharmacy",
    path: "/pharmacist/stock",
    keywords: ["medications", "inventory", "units"],
  },
  {
    label: "Diagnostics",
    section: "Pharmacy",
    path: "/pharmacist/diagnostics",
    keywords: ["patients", "vitals", "labs"],
  },
  {
    label: "Distribution",
    section: "Pharmacy",
    path: "/pharmacist/distribution",
    keywords: ["nurses", "allocate"],
  },
  {
    label: "Predictive Analytics",
    section: "Pharmacy",
    path: "/pharmacist/analytics",
    keywords: ["forecast", "chart", "demand"],
  },
  {
    label: "TLD",
    section: "Pharmacy · Stock",
    path: "/pharmacist/stock",
    keywords: ["arv", "tenofovir"],
  },
  {
    label: "Efavirenz",
    section: "Pharmacy · Stock",
    path: "/pharmacist/stock",
    keywords: ["arv"],
  },
  {
    label: "Rifafour",
    section: "Pharmacy · Stock",
    path: "/pharmacist/stock",
    keywords: ["tb"],
  },
  {
    label: "Insulin",
    section: "Pharmacy · Stock",
    path: "/pharmacist/stock",
    keywords: ["diabetes", "mixtard"],
  },
];

const receptionistIndex: SearchEntry[] = [
  {
    label: "Dashboard",
    section: "Reception · Overview",
    path: "/receptionist",
    keywords: ["home", "stats"],
  },
  {
    label: "Appointments",
    section: "Reception",
    path: "/receptionist/appointments",
    keywords: ["bookings", "today"],
  },
  {
    label: "Registration",
    section: "Reception",
    path: "/receptionist/registration",
    keywords: ["new patient", "form", "signup"],
  },
  {
    label: "Patient Profiles",
    section: "Reception",
    path: "/receptionist/profiles",
    keywords: ["records", "people", "incomplete"],
  },
  {
    label: "Incomplete Profiles",
    section: "Reception · Profiles",
    path: "/receptionist/profiles",
    hash: "incomplete",
    keywords: ["action required", "missing"],
  },
  {
    label: "Consent & Authorisation",
    section: "Reception · Registration",
    path: "/receptionist/registration",
    hash: "consent",
    keywords: ["billing", "permission"],
  },
  {
    label: "File Identification",
    section: "Reception · Registration",
    path: "/receptionist/registration",
    hash: "file-id",
    keywords: ["patient no"],
  },
  {
    label: "Address",
    section: "Reception · Registration",
    path: "/receptionist/registration",
    hash: "address",
    keywords: ["district", "town"],
  },
  {
    label: "Emergency Contact",
    section: "Reception · Registration",
    path: "/receptionist/registration",
    hash: "emergency",
    keywords: ["next of kin"],
  },
  {
    label: "Employment",
    section: "Reception · Registration",
    path: "/receptionist/registration",
    hash: "employment",
    keywords: ["occupation", "employer"],
  },
  {
    label: "Financial Classification",
    section: "Reception · Registration",
    path: "/receptionist/registration",
    hash: "financial",
    keywords: ["medical aid", "self-pay"],
  },
];

const adminIndex: SearchEntry[] = [
  {
    label: "Dashboard",
    section: "Admin · Overview",
    path: "/admin",
    keywords: ["home"],
  },
  {
    label: "Create User",
    section: "Admin",
    path: "/admin/users",
    keywords: ["new", "doctor", "nurse", "pharmacist", "receptionist", "staff"],
  },
  {
    label: "All Staff",
    section: "Admin",
    path: "/admin/staff",
    keywords: ["users", "list", "manage"],
  },
  {
    label: "Audit Logs",
    section: "Admin",
    path: "/admin/audit",
    keywords: ["logs", "system", "activity", "events"],
  },
];

const superAdminIndex: SearchEntry[] = [
  {
    label: "Dashboard",
    section: "Platform",
    path: "/super-admin",
    keywords: ["home"],
  },
  {
    label: "Facilities",
    section: "Platform",
    path: "/super-admin/facilities",
    keywords: ["hospitals", "clinics", "register"],
  },
  {
    label: "Platform Logs",
    section: "Platform",
    path: "/super-admin/audit",
    keywords: ["logs", "audit", "system"],
  },
];

const map: Record<Role, SearchEntry[]> = {
  nurse: nurseIndex,
  doctor: doctorIndex,
  patient: patientIndex,
  pharmacist: pharmacistIndex,
  receptionist: receptionistIndex,
  admin: adminIndex,
  super_admin: superAdminIndex,
};

export function getRoleSearchIndex(role: Role): SearchEntry[] {
  return map[role] || [];
}

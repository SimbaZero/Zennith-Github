import type { AppointmentStatus } from "@/components/AppShell";

// ============================================================
//  Dynamic, auto-updating clinic dataset
//  - All dates relative to "today"
//  - Appointments span 09:00 → 22:00 across multiple doctors with shifts
//  - HIV and AIDS are tracked as DIFFERENT conditions
// ============================================================

const TODAY = new Date();
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const dayOffset = (n: number) => {
  const d = new Date(TODAY);
  d.setDate(d.getDate() + n);
  return isoDate(d);
};

// Tiny seeded RNG so the generated set is stable within a session
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}
const r = rng(42);
const pick = <T,>(arr: T[]) => arr[Math.floor(r() * arr.length)];

// ---------- Source pools ----------
const FIRST = [
  "Thandi", "Sipho", "Ayanda", "Naledi", "Bongani", "Lindiwe", "Themba", "Nomsa",
  "Lerato", "Tshepo", "Nokuthula", "Sandile", "Palesa", "Kagiso", "Refilwe",
  "Mpho", "Zinhle", "Sibusiso", "Karabo", "Anele", "Jabulani", "Busisiwe",
  "Thabo", "Mandisa", "Sizwe", "Khanyi", "Bandile", "Zola", "Senzo", "Nthabiseng",
  "Olwethu", "Lungile", "Mxolisi", "Yandiswa", "Phumzile", "Aviwe", "Khaya",
  "Nolwazi", "Vuyo", "Asanda", "Tumelo", "Buhle", "Sakhile", "Onthatile",
  "Rorisang", "Tshegofatso", "Ntando", "Lwazi", "Boitumelo", "Nelisiwe",
  "Hloni", "Mokgadi", "Pretty", "Reabetswe", "Refiloe", "Sive", "Wandile",
  "Yonela", "Zenande", "Zukiswa",
];
const LAST = [
  "Mokoena", "Dlamini", "Khumalo", "Tshabalala", "Nkosi", "Mahlangu", "Zulu",
  "Naidoo", "Smit", "van der Merwe", "Botha", "Mbeki", "Sithole", "Maseko",
  "Ngcobo", "Radebe", "Mthembu", "Nyathi", "Pillay", "Govender", "Singh",
  "Mokoena", "Mokwena", "Nkomo", "Mokgothu", "Sefako", "Modise", "Phiri",
];
const CONDITIONS = [
  "HIV", "AIDS", "TB", "Hypertension", "Diabetes Type 2", "Asthma",
  "Pregnancy", "Mental Health", "Cardiac", "Chronic Kidney Disease",
];
const TYPES = ["Follow-up", "Consultation", "New Patient", "Lab Review", "Refill"];

// Doctors with shifts (start inclusive, end exclusive)
type Shift = { from: string; to: string };
const DOCTORS: Array<{ name: string; shifts: Shift[] }> = [
  { name: "Dr. Mutizwa", shifts: [{ from: "09:00", to: "13:00" }] },
  { name: "Dr. Gandi",   shifts: [{ from: "13:00", to: "17:00" }] },
  { name: "Dr. Zulu",    shifts: [{ from: "17:00", to: "22:00" }] },
  { name: "Dr. Smit",    shifts: [{ from: "09:00", to: "12:00" }, { from: "19:00", to: "22:00" }] },
  { name: "Dr. Mokoena", shifts: [{ from: "11:00", to: "15:00" }] },
  { name: "Dr. Naidoo",  shifts: [{ from: "15:00", to: "21:00" }] },
];

const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};
const toHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

// ---------- Generate patients (60) ----------
function genPatients() {
  const list: Array<{ id: string; name: string; condition: string; lastVisit: string }> = [];
  const used = new Set<string>();
  let n = 0;
  while (list.length < 60) {
    const name = `${pick(FIRST)} ${pick(LAST)}`;
    if (used.has(name)) continue;
    used.add(name);
    list.push({
      id: `P-${String(481 + n).padStart(4, "0")}`,
      name,
      condition: pick(CONDITIONS),
      lastVisit: dayOffset(-Math.floor(r() * 60) - 1),
    });
    n++;
  }
  return list;
}

export const patients = genPatients();

// ---------- Generate appointments across all doctor shifts ----------
function genAppointments() {
  type A = {
    time: string; patient: string; doctor: string; type: string;
    status: AppointmentStatus; pid: string; note: string;
  };
  const out: A[] = [];
  let pi = 0;
  for (const d of DOCTORS) {
    for (const sh of d.shifts) {
      for (let m = toMin(sh.from); m < toMin(sh.to); m += 30) {
        const p = patients[pi % patients.length];
        pi++;
        out.push({
          time: toHHMM(m),
          patient: p.name,
          doctor: d.name,
          type: pick(TYPES),
          status: "Incomplete",
          pid: p.id,
          note: `${p.condition} · ${pick(["Routine", "Refill", "Review", "Assessment"])}`,
        });
      }
    }
  }
  return out.sort((a, b) => a.time.localeCompare(b.time));
}

export const appointments = genAppointments();

// ---------- Patient-side data (logged-in patient = Thandi if present, else first) ----------
const _self = patients.find((p) => p.name.startsWith("Thandi")) ?? patients[0];
export const currentPatient = {
  id: _self.id,
  name: _self.name,
  idNumber: "8807145678081",
  cell: "081 234 5678",
  age: 34,
  gender: "F",
  status: "Active",
  primaryCondition: _self.condition,
  medication:
    _self.condition === "HIV" || _self.condition === "AIDS"
      ? "TLD (Tenofovir/Lamivudine/Dolutegravir)"
      : _self.condition === "TB"
      ? "Rifafour 150/75/400/275"
      : _self.condition === "Hypertension"
      ? "Amlodipine 5mg"
      : _self.condition === "Diabetes Type 2"
      ? "Metformin 500mg"
      : "On standard regimen",
  lastVisit: _self.lastVisit,
  nextAppointment: `${dayOffset(1)} 09:00`,
  doctor: "Dr. Mutizwa",
};

export const patientAppointments = [
  { date: dayOffset(1), time: "09:00", doctor: "Dr. Mutizwa", type: "Follow-up", status: "Complete" as const },
  { date: dayOffset(15), time: "10:30", doctor: "Dr. Mutizwa", type: "Refill",   status: "Incomplete" as const },
];

export const patientVisits = [
  { date: dayOffset(-30), doctor: "Dr. Mutizwa", note: "ARV refill. Viral load undetectable. Continue treatment." },
  { date: dayOffset(-90), doctor: "Dr. Gandi",   note: "Routine check-up. CD4 count 580. Excellent adherence." },
  { date: dayOffset(-180), doctor: "Dr. Mutizwa", note: "ARV refill. Vitals stable." },
];

export const patientAlerts = [
  { type: "stock" as const, title: "Stock Alert", body: "Your medication (TLD) is available at Hilbrow CHC. Ready for collection.", time: "2h ago", unread: true },
  { type: "appointment" as const, title: "Appointment Reminder", body: `Upcoming appointment with Dr. Mutizwa on ${dayOffset(1)} at 09:00`, time: "1d ago", unread: true },
  { type: "redirect" as const, title: "Redirect Alert", body: "Rifafour unavailable at Hilbrow CHC. Alternative: Orchards Clinic (3.2km)", time: "3d ago", unread: false },
];

// ---------- Pharmacist data ----------
export const stock = [
  { name: "TLD (Tenofovir/Lamivudine/Dolutegravir)", category: "ARV", units: 412, threshold: 200, avgDay: 32, status: "OK" as const },
  { name: "Efavirenz 600mg", category: "ARV", units: 84, threshold: 100, avgDay: 18, status: "Low" as const },
  { name: "Rifafour 150/75/400/275", category: "TB", units: 0, threshold: 80, avgDay: 12, status: "Out" as const },
  { name: "Amlodipine 5mg", category: "HYPERTENSION", units: 620, threshold: 200, avgDay: 28, status: "OK" as const },
  { name: "Metformin 500mg", category: "DIABETES", units: 142, threshold: 150, avgDay: 22, status: "Low" as const },
  { name: "Hydrochlorothiazide 25mg", category: "HYPERTENSION", units: 388, threshold: 120, avgDay: 14, status: "OK" as const },
  { name: "Insulin Mixtard 30", category: "DIABETES", units: 24, threshold: 40, avgDay: 6, status: "Low" as const },
];

export const diagnostics = patients.slice(0, 8).map((p) => ({
  patient: p.name,
  condition: p.condition,
  viralLoad: p.condition === "HIV" || p.condition === "AIDS" ? "Undetectable" : "N/A",
  cd4: p.condition === "HIV" ? "580" : p.condition === "AIDS" ? "210" : "N/A",
  bp: p.condition === "Hypertension" || p.condition === "Cardiac" ? "138/92" : "N/A",
  glucose: p.condition === "Diabetes Type 2" ? "7.2 mmol/L" : "N/A",
  lastVisit: p.lastVisit,
}));

export const nurses = ["Olorato", "Nobuhle", "Michelle"];

export const tldForecast = [42, 38, 35, 44, 48, 52, 55, 58, 56, 60, 65, 68, 72, 75];

export const highRisk = [
  { name: "Efavirenz 600mg", current: 84, avgDay: 18, daysLeft: 4, status: "Low" as const },
  { name: "Rifafour 150/75/400/275", current: 0, avgDay: 12, daysLeft: 0, status: "Out" as const },
  { name: "Insulin Mixtard 30", current: 24, avgDay: 6, daysLeft: 4, status: "Low" as const },
];

// ---------- Schedule helpers (auto-update with the calendar) ----------
export const scheduleDays = Array.from({ length: 5 }, (_, i) => {
  const d = new Date(TODAY);
  d.setDate(d.getDate() + i);
  return {
    iso: isoDate(d),
    label: d.toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short" }),
  };
});

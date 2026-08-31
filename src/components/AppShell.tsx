import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { ZennithStar } from "./ZennithStar";
import {
  Bell,
  LogOut,
  Search,
  ChevronLeft,
  LayoutDashboard,
  Calendar,
  ScanLine,
  Users,
  CalendarDays,
  UserCircle2,
  FileText,
  BellRing,
  Boxes,
  Activity,
  Share2,
  LineChart,
  ClipboardList,
  UserPlus,
  ShieldCheck,
  X,
  Building2,
  ShieldQuestion,
  Truck,
  Package,
  type LucideIcon,
} from "lucide-react";
import { clearAuth, displayNameFor, getUsername, type Role } from "@/lib/auth";
import { useState, useMemo, useEffect, useRef, type ReactNode } from "react";
import { getRoleSearchIndex, type SearchEntry } from "@/lib/search-index";
import { getNotifications, type Notification } from "@/lib/notifications";
import {
  useCurrentPatient,
  usePatientNotifications,
  markNotificationRead,
} from "@/lib/patient-service";
import { useCurrentPharmacist } from "@/lib/pharmacist-service";
import { useCurrentDoctor } from "@/lib/doctor-service";
import { useRealActiveClinic } from "@/lib/active-clinic";
import {
  useNotifications,
  useNotificationsByProfile,
  markRead,
  markAllRead,
} from "@/lib/notify";
import { useQuery } from "@tanstack/react-query";
import { useCurrentNurse } from "@/lib/nurse-service";
import { resolveCurrentReceptionist } from "@/lib/clinic-data";
import { useCurrentAdmin } from "@/lib/auth";

export type NavItem = { to: string; label: string; icon: LucideIcon };

const navByRole: Record<Role, NavItem[]> = {
  nurse: [
    { to: "/nurse", label: "Dashboard", icon: LayoutDashboard },
    { to: "/nurse/appointments", label: "Appointments", icon: Calendar },
    { to: "/nurse/digitize", label: "Digitize Files", icon: ScanLine },
    { to: "/nurse/patients", label: "Patients", icon: Users },
    { to: "/nurse/stock", label: "Stock", icon: Package },
  ],
  doctor: [
    { to: "/doctor", label: "Dashboard", icon: LayoutDashboard },
    { to: "/doctor/appointments", label: "Appointments", icon: Calendar },
    { to: "/doctor/patients", label: "Patient Files", icon: UserCircle2 },
  ],
  patient: [
    { to: "/patient", label: "Dashboard", icon: LayoutDashboard },
    { to: "/patient/medical-record", label: "Medical Record", icon: FileText },
    { to: "/patient/appointments", label: "Appointments", icon: Calendar },
    { to: "/patient/alerts", label: "Alerts", icon: BellRing },
    { to: "/patient/privacy", label: "Privacy & Data", icon: ShieldQuestion },
  ],
  pharmacist: [
    { to: "/pharmacist", label: "Dashboard", icon: LayoutDashboard },
    { to: "/pharmacist/stock", label: "Stock Levels", icon: Boxes },
    {
      to: "/pharmacist/diagnostics",
      label: "Prescription Lookup",
      icon: Search,
    },

    { to: "/pharmacist/deliveries", label: "Deliveries", icon: Truck },
    {
      to: "/pharmacist/analytics",
      label: "Medication Overview",
      icon: LineChart,
    },
  ],
  receptionist: [
    { to: "/receptionist", label: "Dashboard", icon: LayoutDashboard },
    { to: "/receptionist/queue", label: "Acute Queue", icon: ClipboardList },
    { to: "/receptionist/appointments", label: "Appointments", icon: Calendar },
    {
      to: "/receptionist/registration",
      label: "Registration",
      icon: ClipboardList,
    },
    {
      to: "/receptionist/profiles",
      label: "Patient Profiles",
      icon: UserCircle2,
    },
  ],
  admin: [
    { to: "/admin", label: "Dashboard", icon: LayoutDashboard },
    { to: "/admin/users", label: "Create User", icon: UserPlus },
    { to: "/admin/staff", label: "All Staff", icon: ShieldCheck },
    { to: "/admin/audit", label: "Audit Logs", icon: Activity },
  ],
  super_admin: [
    { to: "/super-admin", label: "Dashboard", icon: LayoutDashboard },
    { to: "/super-admin/facilities", label: "Facilities", icon: Building2 },
    { to: "/super-admin/audit", label: "Platform Logs", icon: Activity },
  ],
};

const staffCanSwitch: Partial<Record<Role, boolean>> = {
  pharmacist: true,
  doctor: true,
  super_admin: true,
};

export function AppShell({
  role,
  title,
  showBack = true,
  children,
  clinicNameOverride,
  staffNameOverride,
}: {
  role: Role;
  title: string;
  showBack?: boolean;
  children: ReactNode;
  // Real clinic name resolved from Firestore (e.g. via
  // resolveCurrentReceptionist()), for roles that have a real per-user
  // clinic lookup already. When omitted, falls back to the old fake
  // localStorage clinic switcher — see lib/clinic.ts. Roles that can
  // legitimately switch between clinics (pharmacist, super_admin) keep
  // using the switchable fake system for now; this is scoped to fixing
  // the receptionist disconnect without touching modules not yet audited.
  clinicNameOverride?: string | null;
  // Real staff name resolved from Firestore (e.g. via
  // resolveCurrentReceptionist().name). Without this the sidebar falls back
  // to capitalizing the LOGIN USERNAME, which is meaningless when the
  // username is generic/shared (e.g. "receptionist") rather than a real
  // person's name.
  staffNameOverride?: string | null;
}) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const items = navByRole[role];
  const [open, setOpen] = useState(false);

  const handleSignOut = () => {
    clearAuth();
    navigate({ to: "/login" });
  };

  const username = typeof window !== "undefined" ? getUsername() : "";
  const { patient: sidebarPatient } = useCurrentPatient();
  // Real pharmacist data. clinicIds/fullName are undefined for every other
  // role, so this does no Firestore reads when not relevant.
  const { pharmacist } = useCurrentPharmacist();
  const realPharmacistClinic = useRealActiveClinic(
    pharmacist?.clinicIds,
    "pharmacist",
  );
  // Real doctor data — same idea, just for Doctor's own clinicIds.
  const { doctor } = useCurrentDoctor();
  const realDoctorClinic = useRealActiveClinic(doctor?.clinicIds, "doctor");
  const display =
    role === "patient" && sidebarPatient?.fullName
      ? sidebarPatient.fullName
      : role === "pharmacist" && pharmacist?.fullName
        ? pharmacist.fullName
        : (staffNameOverride ?? displayNameFor(role, username));
  const initial = display.charAt(0).toUpperCase();
  const canSwitch = !!staffCanSwitch[role];
  const siteLabel =
    role === "super_admin"
      ? "Zennith Platform · All facilities"
      : role === "patient"
        ? "Patient Portal"
        : role === "pharmacist"
          ? (clinicNameOverride ??
            realPharmacistClinic.activeClinicName ??
            "Loading clinic…")
          : role === "doctor"
            ? (clinicNameOverride ??
              realDoctorClinic.activeClinicName ??
              "Loading clinic…")
            : (clinicNameOverride ?? "Zennith");

  return (
    <div className="min-h-screen flex bg-[oklch(0.97_0.01_240)]">
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-40 w-64 bg-[oklch(0.18_0.06_260)] text-white flex flex-col transition-transform ${
          open ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        <div className="p-5 border-b border-white/10 flex items-center gap-3">
          <ZennithStar size={36} />
          <div className="leading-tight">
            <div className="font-bold text-lg">Zennith</div>
            <div className="text-[10px] tracking-[0.2em] text-white/50">
              {role.toUpperCase()}
            </div>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {items.map((item) => {
            const active = pathname === item.to;
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors ${
                  active
                    ? "bg-[oklch(0.55_0.18_245)] text-white"
                    : "text-white/70 hover:bg-white/5"
                }`}
              >
                <Icon size={18} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-4 border-t border-white/10 flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center font-semibold text-sm">
            {initial}
          </div>
          <div className="text-sm leading-tight">
            <div className="font-semibold">{display}</div>
            <div className="text-[11px] text-white/50">{siteLabel}</div>
          </div>
        </div>
      </aside>

      {open && (
        <div
          className="fixed inset-0 bg-black/40 z-30 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      <main className="flex-1 flex flex-col min-w-0">
        <header className="bg-white border-b px-4 lg:px-6 h-16 flex items-center gap-3 sticky top-0 z-20">
          <button
            className="lg:hidden p-2"
            onClick={() => setOpen(true)}
            aria-label="Menu"
          >
            <span className="block w-5 h-0.5 bg-foreground mb-1" />
            <span className="block w-5 h-0.5 bg-foreground mb-1" />
            <span className="block w-5 h-0.5 bg-foreground" />
          </button>
          {showBack && (
            <button
              onClick={() => window.history.back()}
              className="p-1.5 hover:bg-secondary rounded-md text-muted-foreground"
              aria-label="Back"
            >
              <ChevronLeft size={20} />
            </button>
          )}
          <h1 className="font-semibold text-base lg:text-lg truncate">
            {title}
          </h1>
          <div className="flex-1" />
          {role !== "patient" &&
            role !== "super_admin" &&
            (role === "pharmacist" ? (
              <ClinicChip
                clinicId={realPharmacistClinic.activeClinicId ?? ""}
                clinicName={
                  clinicNameOverride ??
                  realPharmacistClinic.activeClinicName ??
                  "Loading clinic…"
                }
                canSwitch={canSwitch && clinicNameOverride == null}
                onSwitch={(id) =>
                  realPharmacistClinic.setActiveClinicId(Number(id))
                }
                options={realPharmacistClinic.options.map((o) => ({
                  id: o.clinicId,
                  name: o.clinicName,
                }))}
              />
            ) : role === "doctor" ? (
              <ClinicChip
                clinicId={realDoctorClinic.activeClinicId ?? ""}
                clinicName={
                  clinicNameOverride ??
                  realDoctorClinic.activeClinicName ??
                  "Loading clinic…"
                }
                canSwitch={canSwitch && clinicNameOverride == null}
                onSwitch={(id) =>
                  realDoctorClinic.setActiveClinicId(Number(id))
                }
                options={realDoctorClinic.options.map((o) => ({
                  id: o.clinicId,
                  name: o.clinicName,
                }))}
              />
            ) : clinicNameOverride ? (
              // Nurse, Receptionist and Admin are single-clinic: they pass
              // their real clinic name from Firestore, and can't switch.
              // Previously this fell back to a hardcoded 3-clinic list that
              // had nothing to do with the real clinics collection.
              <ClinicChip
                clinicId=""
                clinicName={clinicNameOverride}
                canSwitch={false}
                onSwitch={() => {}}
                options={[]}
              />
            ) : null)}
          <ScopedSearch role={role} />
          <NotificationsButton role={role} />
          <button
            onClick={handleSignOut}
            className="flex items-center gap-2 px-3 py-2 border rounded-md hover:bg-secondary text-sm"
          >
            <LogOut size={15} />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </header>

        <div className="flex-1 p-4 lg:p-6 animate-fade-in">{children}</div>
      </main>
    </div>
  );
}

function ScopedSearch({ role }: { role: Role }) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [openList, setOpenList] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const index = useMemo(() => getRoleSearchIndex(role), [role]);
  const results = useMemo<SearchEntry[]>(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    return index
      .filter(
        (e) =>
          e.label.toLowerCase().includes(term) ||
          e.keywords.some((k) => k.toLowerCase().includes(term)),
      )
      .slice(0, 8);
  }, [q, index]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpenList(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const go = (r: SearchEntry) => {
    setQ("");
    setOpenList(false);
    // TanStack Router's navigate() is strictly typed to a known route union,
    // but search results can link to any role's routes dynamically — cast
    // through unknown instead of any to keep the escape hatch lint-clean.
    (navigate as unknown as (opts: { to: string; hash?: string }) => void)({
      to: r.path,
      hash: r.hash,
    });
    if (r.hash && typeof window !== "undefined") {
      setTimeout(() => {
        const el = document.getElementById(r.hash!);
        el?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    }
  };

  return (
    <div className="relative hidden md:block" ref={ref}>
      <div className="flex items-center gap-2 bg-secondary rounded-md px-3 py-2 w-72">
        <Search size={16} className="text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpenList(true);
          }}
          onFocus={() => setOpenList(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && results[0]) go(results[0]);
          }}
          type="text"
          placeholder="Search this dashboard..."
          className="bg-transparent outline-none text-sm flex-1"
        />
      </div>
      {openList && q.trim() && (
        <div className="absolute right-0 mt-1 w-80 bg-white border rounded-md shadow-lg z-50 max-h-80 overflow-y-auto">
          {results.length === 0 ? (
            <div className="p-3 text-sm text-muted-foreground">
              No matches in your dashboard.
            </div>
          ) : (
            results.map((r, i) => (
              <button
                key={i}
                onClick={() => go(r)}
                className="w-full text-left px-3 py-2 hover:bg-secondary border-b last:border-b-0"
              >
                <div className="text-sm font-medium">{r.label}</div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {r.section}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function NotificationsButton({ role }: { role: Role }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // Real for EVERY role now. The notifications collection was always keyed
  // on the numeric users.userId — which every role has — but only Patients
  // were ever wired to it; the rest rendered a hardcoded fake list.
  const { patient } = useCurrentPatient();
  const { nurse } = useCurrentNurse();
  const { doctor } = useCurrentDoctor();
  const { pharmacist } = useCurrentPharmacist();
  const { data: receptionist } = useQuery({
    queryKey: ["current-receptionist"],
    queryFn: resolveCurrentReceptionist,
    enabled: role === "receptionist",
  });
  const { admin } = useCurrentAdmin();

  const userId =
    role === "patient"
      ? patient?.userId
      : role === "nurse"
        ? nurse?.userId
        : role === "doctor"
          ? doctor?.userId
          : role === "pharmacist"
            ? pharmacist?.userId
            : role === "receptionist"
              ? receptionist?.userId
              : undefined;

  // Admins are addressed by profile id, everyone else by numeric userId.
  const byUserId = useNotifications(role === "admin" ? undefined : userId);
  const byProfile = useNotificationsByProfile(
    role === "admin" ? admin?.profileId : undefined,
  );
  const items = role === "admin" ? byProfile : byUserId;

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const unread = items.filter((i) => !i.isRead).length;

  return (
    <div className="relative" ref={ref}>
      <button
        className="relative p-2 hover:bg-secondary rounded-md"
        aria-label="Notifications"
        onClick={() => setOpen((v) => !v)}
      >
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-destructive text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-80 bg-white border rounded-md shadow-lg z-50">
          <div className="flex items-center justify-between p-3 border-b">
            <span className="font-semibold text-sm">Notifications</span>
            {unread > 0 && (
              <button
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={() =>
                  markAllRead(
                    items.filter((i) => !i.isRead).map((i) => i.docId),
                  )
                }
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 ? (
              <div className="p-8 text-center">
                <Bell
                  size={28}
                  className="mx-auto text-muted-foreground/50 mb-2"
                />
                <p className="text-sm text-muted-foreground">
                  No notifications
                </p>
              </div>
            ) : (
              items.map((n) => (
                <button
                  key={n.docId}
                  onClick={() => {
                    if (!n.isRead) markRead(n.docId);
                    // A notification should be a way IN, not just an
                    // announcement — jump to where you can act on it.
                    if (n.link) {
                      setOpen(false);
                      navigate({ to: n.link as any });
                    }
                  }}
                  className={`w-full text-left p-3 border-b last:border-b-0 hover:bg-secondary/50 ${
                    !n.isRead ? "bg-[oklch(0.97_0.03_245)]" : ""
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {!n.isRead && (
                      <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[oklch(0.55_0.18_245)] shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="font-medium text-sm">{n.title}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {n.message}
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-1">
                        {formatNotifTime(n.timeSent)}
                      </div>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function formatNotifTime(raw: string) {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "";
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return d.toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
}

function ClinicChip({
  clinicId,
  clinicName,
  canSwitch,
  onSwitch,
  options,
}: {
  clinicId: string | number;
  clinicName: string;
  canSwitch: boolean;
  onSwitch: (id: string | number) => void;
  options: { id: string | number; name: string; area?: string }[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const on = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", on);
    return () => document.removeEventListener("mousedown", on);
  }, []);
  if (!canSwitch) {
    return (
      <div className="hidden sm:flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full border bg-secondary/40 text-muted-foreground">
        <Building2 size={12} /> {clinicName}
      </div>
    );
  }
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full border bg-white hover:bg-secondary/60"
      >
        <Building2 size={12} />{" "}
        <span className="font-medium">{clinicName}</span>
        <span className="text-muted-foreground">▾</span>
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-56 bg-white border rounded-md shadow-lg z-50">
          <div className="text-[10px] tracking-wider text-muted-foreground p-2 border-b">
            SWITCH CLINIC
          </div>
          {options.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                onSwitch(c.id);
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-2 hover:bg-secondary text-sm border-b last:border-b-0 ${c.id === clinicId ? "bg-[oklch(0.97_0.03_245)]" : ""}`}
            >
              <div className="font-medium">{c.name}</div>
              {c.area && (
                <div className="text-[11px] text-muted-foreground">
                  {c.area}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export type StockStatus = "OK" | "Low" | "Out";
export type AppointmentStatus =
  | "Complete"
  | "Incomplete"
  | "No-show"
  | "In-progress"
  | "Scheduled"
  | "Confirmed";
export type AnyStatus = StockStatus | AppointmentStatus;

/** Compute status from current units vs threshold:
 *  Out: 0 · Low: <= 20% above threshold (i.e., units <= threshold * 1.2) · OK: above */
export function computeStockStatus(
  units: number,
  threshold: number,
): StockStatus {
  if (units <= 0) return "Out";
  if (units < threshold * 1.2) return "Low";
  return "OK";
}

export function StatusBadge({ status }: { status: AnyStatus }) {
  const map: Record<AnyStatus, string> = {
    OK: "bg-[oklch(0.94_0.08_160)] text-[oklch(0.3_0.15_160)]",
    Low: "bg-[oklch(0.96_0.1_85)] text-[oklch(0.4_0.15_70)]",
    Out: "bg-[oklch(0.94_0.08_25)] text-[oklch(0.4_0.2_25)]",
    Complete: "bg-[oklch(0.55_0.18_150)] text-white",
    "In-progress": "bg-[oklch(0.6_0.16_165)] text-white",
    Incomplete: "bg-[oklch(0.82_0.19_95)] text-white",
    "No-show": "bg-[oklch(0.55_0.22_25)] text-white",
    Scheduled: "bg-[oklch(0.94_0.05_245)] text-[oklch(0.4_0.15_245)]",
    Confirmed: "bg-[oklch(0.94_0.08_160)] text-[oklch(0.3_0.15_160)]",
  };
  const labels: Record<AnyStatus, string> = {
    OK: "OK",
    Low: "Low",
    Out: "Out of stock",
    Complete: "Complete",
    "In-progress": "In-progress",
    Incomplete: "Incomplete",
    "No-show": "No-show",
    Scheduled: "Scheduled",
    Confirmed: "Confirmed",
  };
  return (
    <span
      className={`px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${map[status]}`}
    >
      {labels[status]}
    </span>
  );
}

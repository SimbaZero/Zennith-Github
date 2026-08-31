import { createFileRoute, Link } from "@tanstack/react-router";
import { ZennithStar } from "@/components/ZennithStar";
import { AuthBackground } from "@/components/AuthBackground";
import {
  HeartPulse,
  ShieldCheck,
  Users,
  Activity,
  Clock,
  UserPlus,
  Building2,
} from "lucide-react";
import { useNow } from "@/lib/store";
import { useQuery } from "@tanstack/react-query";
import { listClinics, usePublicQueueSummary } from "@/lib/clinic-data";
import { useState } from "react";

export const Route = createFileRoute("/")({
  component: Home,
  head: () => ({
    meta: [
      { title: "Zennith — Smarter healthcare for South Africa" },
      {
        name: "description",
        content:
          "Zennith helps South African hospitals run smoothly so doctors, nurses, pharmacists and patients can focus on care.",
      },
      {
        property: "og:title",
        content: "Zennith — Smarter healthcare for South Africa",
      },
      {
        property: "og:description",
        content:
          "A unified platform connecting doctors, nurses, pharmacists, receptionists and patients across South Africa.",
      },
    ],
  }),
});

function Home() {
  const now = useNow(15_000);

  return (
    <AuthBackground videoSrc="/login-bg.mp4">
      <div className="w-full max-w-5xl">
        {/* Top nav */}
        <header className="flex items-center justify-between bg-white/95 backdrop-blur rounded-2xl shadow-lg px-5 py-3 mb-6">
          <div className="flex items-center gap-3">
            <ZennithStar size={36} spin />
            <div className="leading-tight">
              <div className="font-bold">Zennith</div>
              <div className="text-[10px] tracking-[0.18em] text-muted-foreground">
                PEAK · PERFORMANCE · STANDARDS
              </div>
            </div>
          </div>
          <nav className="flex items-center gap-2">
            <Link
              to="/login"
              className="px-4 py-2 rounded-md text-sm font-medium border hover:bg-secondary"
            >
              Login
            </Link>
            <Link
              to="/signup"
              className="px-4 py-2 rounded-md text-sm font-medium bg-[oklch(0.18_0.06_260)] text-white hover:bg-[oklch(0.25_0.08_260)]"
            >
              Sign up
            </Link>
          </nav>
        </header>

        {/* Hero */}
        <section className="bg-white/95 backdrop-blur rounded-2xl shadow-2xl p-8 lg:p-10 animate-fade-up">
          <div className="grid lg:grid-cols-2 gap-8 items-center">
            <div>
              <p className="text-xs tracking-[0.2em] text-[oklch(0.55_0.18_245)] font-semibold">
                FOR SOUTH AFRICA'S MEDICAL SYSTEM
              </p>
              <h1 className="text-3xl lg:text-4xl font-bold mt-2 leading-tight">
                Better care, fewer queues, less paperwork.
              </h1>
              <p className="text-muted-foreground mt-4">
                Zennith is a unified platform built to help South Africa's
                medical system work seamlessly. Our priority is people —
                patients, doctors, nurses, pharmacists and reception staff — all
                on one shared system that respects their time.
              </p>

              <Link
                to="/login"
                className="inline-block mt-6 px-6 py-3 rounded-md font-medium bg-[oklch(0.18_0.06_260)] text-white hover:bg-[oklch(0.25_0.08_260)]"
              >
                Login to your dashboard
              </Link>

              {/* Sign-up routes as distinct cards rather than plain buttons.
                  There are several kinds of account now — patient, clinic,
                  and pharmacy to come — so "who are you?" matters more than
                  one generic Create Account. */}
              <div className="mt-8 pt-6 border-t">
                <p className="text-[11px] tracking-wider text-muted-foreground mb-3">
                  NEW TO ZENNITH?
                </p>
                <div className="grid sm:grid-cols-2 gap-3">
                  <Link
                    to="/signup"
                    className="group border rounded-lg p-4 hover:border-[oklch(0.55_0.18_245)] hover:shadow-sm transition bg-white"
                  >
                    <div className="flex items-center gap-2">
                      <UserPlus
                        size={16}
                        className="text-[oklch(0.55_0.18_245)]"
                      />
                      <p className="font-medium text-sm">I'm a patient</p>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1.5">
                      Book appointments, track medication and see live queues.
                    </p>
                    <p className="text-xs font-medium text-[oklch(0.55_0.18_245)] mt-2 group-hover:underline">
                      Create an account →
                    </p>
                  </Link>

                  <Link
                    to="/clinic-signup"
                    className="group border rounded-lg p-4 hover:border-[oklch(0.55_0.18_245)] hover:shadow-sm transition bg-white"
                  >
                    <div className="flex items-center gap-2">
                      <Building2
                        size={16}
                        className="text-[oklch(0.55_0.18_245)]"
                      />
                      <p className="font-medium text-sm">I run a clinic</p>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1.5">
                      Public or private. Manage staff, queues, records and
                      stock.
                    </p>
                    <p className="text-xs font-medium text-[oklch(0.55_0.18_245)] mt-2 group-hover:underline">
                      Register your clinic →
                    </p>
                  </Link>
                </div>
              </div>
            </div>

            {/* Live queue — real and public. Replaces a hardcoded demo queue
                whose "patients" and outcomes were generated from a hash of
                made-up names. */}
            <PublicQueue />
          </div>
        </section>

        {/* Value props */}
        <section className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
          {[
            {
              icon: HeartPulse,
              title: "Patient-first",
              body: "Real-time medication, appointment and alert info — no more guesswork.",
            },
            {
              icon: Users,
              title: "Connected staff",
              body: "Doctors, nurses, pharmacists and reception share one source of truth.",
            },
            {
              icon: Activity,
              title: "Live operations",
              body: "Queues, stock and schedules update in real time across the hospital.",
            },
            {
              icon: ShieldCheck,
              title: "Secure & local",
              body: "Built around the realities of South African public health facilities.",
            },
          ].map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="bg-white/95 backdrop-blur rounded-xl p-5 shadow"
            >
              <Icon size={20} className="text-[oklch(0.55_0.18_245)]" />
              <h3 className="font-semibold mt-2">{title}</h3>
              <p className="text-sm text-muted-foreground mt-1">{body}</p>
            </div>
          ))}
        </section>

        <p className="text-center text-xs text-white/80 mt-6">
          © {now.getFullYear()} Zennith Health Services
        </p>
      </div>
    </AuthBackground>
  );
}

function PublicQueue() {
  const { data: clinics = [] } = useQuery({
    queryKey: ["clinics"],
    queryFn: listClinics,
  });
  const active = clinics.filter((c) => c.status === "active");
  const [selected, setSelected] = useState<number | null>(null);
  const [nearest, setNearest] = useState<number | null>(null);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);

  const clinicId = selected ?? nearest ?? active[0]?.clinicId ?? null;
  const summary = usePublicQueueSummary(clinicId);
  const chosen = active.find((c) => c.clinicId === clinicId);

  // Coordinates are stored as "26.1946 S, 28.0473 E" — parse to numbers.
  const parseCoords = (raw?: string): [number, number] | null => {
    if (!raw) return null;
    const m = raw.match(/([\d.]+)\s*([NS])\s*,\s*([\d.]+)\s*([EW])/i);
    if (!m) return null;
    const lat = Number(m[1]) * (m[2].toUpperCase() === "S" ? -1 : 1);
    const lng = Number(m[3]) * (m[4].toUpperCase() === "W" ? -1 : 1);
    return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
  };

  const findNearest = () => {
    if (!navigator.geolocation) {
      setLocError("Your browser can't share location.");
      return;
    }
    setLocating(true);
    setLocError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        let best: { id: number; dist: number } | null = null;
        for (const c of active) {
          const coords = parseCoords(c.address);
          if (!coords) continue;
          // Straight-line distance is enough to rank nearby clinics.
          const dLat = coords[0] - latitude;
          const dLng = coords[1] - longitude;
          const dist = Math.sqrt(dLat * dLat + dLng * dLng);
          if (!best || dist < best.dist) best = { id: c.clinicId, dist };
        }
        setLocating(false);
        if (!best) {
          setLocError("No clinics have location data yet.");
          return;
        }
        setNearest(best.id);
        setSelected(best.id);
      },
      () => {
        setLocating(false);
        setLocError("Couldn't get your location.");
      },
      { timeout: 8000 },
    );
  };

  return (
    <div className="bg-[oklch(0.18_0.06_260)] text-white rounded-xl p-6">
      <div className="flex items-center gap-2 mb-4">
        <Clock size={16} className="text-white/70" />
        <span className="text-xs tracking-[0.18em] text-white/70">
          LIVE QUEUE
        </span>
        <button
          onClick={findNearest}
          disabled={locating}
          className="ml-auto text-[11px] bg-white/10 hover:bg-white/20 border border-white/20 rounded-full px-3 py-1 disabled:opacity-50"
        >
          {locating ? "Locating…" : "Nearest to me"}
        </button>
      </div>

      <select
        value={clinicId ?? ""}
        onChange={(e) => setSelected(Number(e.target.value))}
        className="w-full bg-white/10 border border-white/20 rounded-md px-3 py-2.5 text-sm mb-1 outline-none"
      >
        {active.length === 0 ? (
          <option value="">No clinics available</option>
        ) : (
          active.map((c) => (
            <option key={c.clinicId} value={c.clinicId} className="text-black">
              {c.clinicName}
              {c.clinicId === nearest ? " · nearest" : ""}
            </option>
          ))
        )}
      </select>
      {locError && <p className="text-[11px] text-white/50 mb-3">{locError}</p>}

      {summary.loading ? (
        <p className="text-sm text-white/60 py-10 text-center">Loading…</p>
      ) : (
        <>
          <div className="bg-white/5 rounded-lg p-5 text-center mt-3">
            {summary.avgWaitMin != null ? (
              <>
                <p className="text-[10px] tracking-wider text-white/60">
                  TYPICAL WAIT RIGHT NOW
                </p>
                <p className="text-5xl font-bold mt-1 leading-none">
                  ~{summary.avgWaitMin}
                  <span className="text-lg font-medium ml-1.5">min</span>
                </p>
              </>
            ) : (
              <p className="text-sm text-white/60 py-3">
                Not enough visits today to estimate a wait.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 mt-3">
            <div className="bg-white/5 rounded-md p-3 text-center">
              <p className="text-[10px] tracking-wider text-white/60">
                WAITING
              </p>
              <p className="text-2xl font-bold mt-1">{summary.waiting}</p>
            </div>
            <div className="bg-white/5 rounded-md p-3 text-center">
              <p className="text-[10px] tracking-wider text-white/60">
                BEING SEEN
              </p>
              <p className="text-2xl font-bold mt-1">{summary.inProgress}</p>
            </div>
          </div>

          <p className="text-[11px] text-white/50 mt-3">
            {chosen?.clinicName ?? "This clinic"} · live. Check before you
            travel.
          </p>
        </>
      )}
    </div>
  );
}

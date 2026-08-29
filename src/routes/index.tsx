import { createFileRoute, Link } from "@tanstack/react-router";
import { ZennithStar } from "@/components/ZennithStar";
import { AuthBackground } from "@/components/AuthBackground";
import { HeartPulse, ShieldCheck, Users, Activity, Clock } from "lucide-react";
import {
  useAppointments,
  useNow,
  computeEffective,
  queueForNow,
} from "@/lib/store";
import { useMounted } from "@/lib/offline";

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
  const appts = useAppointments();
  const now = useNow(15_000);
  const mounted = useMounted();
  const effective = computeEffective(appts, now);
  const queue = queueForNow(effective, now);
  const inProgress = effective.filter((a) => a.status === "In-progress");

  const timeStr = mounted
    ? now.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })
    : "--:--";

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
              <div className="flex flex-wrap gap-3 mt-6">
                <Link
                  to="/login"
                  className="px-5 py-2.5 rounded-md font-medium bg-[oklch(0.18_0.06_260)] text-white hover:bg-[oklch(0.25_0.08_260)]"
                >
                  Login to your dashboard
                </Link>
                <Link
                  to="/signup"
                  className="border px-6 py-3 rounded-md font-medium hover:bg-secondary transition"
                >
                  Create an account
                </Link>
                <Link
                  to="/clinic-signup"
                  className="border px-6 py-3 rounded-md font-medium hover:bg-secondary transition"
                >
                  Register your clinic
                </Link>
              </div>
            </div>

            {/* Live queue */}
            <div className="bg-[oklch(0.18_0.06_260)] text-white rounded-xl p-6">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Clock size={16} className="text-white/70" />
                  <span className="text-xs tracking-[0.18em] text-white/70">
                    LIVE · HILLBROW CHC
                  </span>
                </div>
                <span className="font-mono text-sm">{timeStr}</span>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="bg-white/5 rounded-md p-3">
                  <p className="text-[10px] tracking-wider text-white/60">
                    IN PROGRESS
                  </p>
                  <p className="text-2xl font-bold mt-1">{inProgress.length}</p>
                </div>
                <div className="bg-white/5 rounded-md p-3">
                  <p className="text-[10px] tracking-wider text-white/60">
                    NEXT 60 MIN
                  </p>
                  <p className="text-2xl font-bold mt-1">{queue.length}</p>
                </div>
              </div>
              <div className="space-y-1.5 max-h-44 overflow-y-auto">
                {queue.length === 0 ? (
                  <p className="text-xs text-white/60">
                    No appointments in the next hour.
                  </p>
                ) : (
                  queue.map((a, i) => (
                    <div
                      key={`${a.time}-${i}`}
                      className="flex items-center justify-between bg-white/5 rounded-md px-3 py-2"
                    >
                      <span className="font-mono text-sm">{a.time}</span>
                      <span className="text-sm flex-1 mx-3 truncate text-white/70">
                        Patient #{String(i + 1).padStart(2, "0")}
                      </span>
                      <span className="text-xs text-white/60">Scheduled</span>
                    </div>
                  ))
                )}
              </div>
            </div>
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

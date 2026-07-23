import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Eye, EyeOff, ChevronLeft, ChevronRight, Building2 } from "lucide-react";
import { ZennithStar } from "@/components/ZennithStar";
import { checkCredentials } from "@/lib/auth";
import { CLINICS, setActiveClinicId, type ClinicId, DEFAULT_CLINIC } from "@/lib/clinic";
import heroClinic1 from "@/assets/hero-clinic-1.jpg";
import heroClinic2 from "@/assets/hero-clinic-2.jpg";
import heroClinic3 from "@/assets/hero-clinic-3.jpg";

export const Route = createFileRoute("/login")({ component: Login });

const SLIDES = [
  {
    img: heroClinic1,
    title: "Care, connected.",
    body: "Nurses, doctors, pharmacists and patients on one shared clinic system.",
  },
  {
    img: heroClinic2,
    title: "No one waits in the dark.",
    body: "Live queues, real-time medication and appointment alerts.",
  },
  {
    img: heroClinic3,
    title: "Built for South Africa.",
    body: "Designed around the realities of Hillbrow, Yeoville and Orchards clinics.",
  },
];

function Login() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [clinic, setClinic] = useState<ClinicId>(DEFAULT_CLINIC);
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [slide, setSlide] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setSlide((s) => (s + 1) % SLIDES.length), 5000);
    return () => clearInterval(id);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    setTimeout(() => {
      const user = checkCredentials(username, password);
      if (!user) {
        setError("Invalid credentials. Please try again.");
        setLoading(false);
        return;
      }
      const fac = user.facilityId ?? clinic;
      if (user.role !== "super_admin" && user.role !== "patient") setActiveClinicId(fac as ClinicId);
      navigate({ to: "/two-factor", search: { role: user.role, u: username.trim(), f: fac ?? "" } });
    }, 500);
  };

  const current = SLIDES[slide];

  return (
    <div className="min-h-screen relative overflow-hidden bg-[oklch(0.16_0.07_265)]">
      {/* Background video with tint */}
      <video
        src="/login-bg.mp4"
        autoPlay loop muted playsInline
        className="absolute inset-0 w-full h-full object-cover z-0 opacity-50"
      />
      <div className="absolute inset-0 z-0 bg-gradient-to-br from-[oklch(0.16_0.07_265)]/80 via-[oklch(0.20_0.09_255)]/70 to-[oklch(0.30_0.13_240)]/70" />

      <div className="relative z-10 min-h-screen flex items-center justify-center p-4 lg:p-8">
        <div className="w-full max-w-6xl bg-white/95 backdrop-blur-xl rounded-3xl shadow-2xl overflow-hidden grid lg:grid-cols-[1.1fr_1fr] animate-fade-up">

          {/* LEFT — image carousel + brand panel */}
          <div className="relative min-h-[420px] lg:min-h-[640px] hidden md:block">
            {SLIDES.map((s, i) => (
              <div
                key={i}
                className="absolute inset-0 transition-opacity duration-1000"
                style={{ opacity: i === slide ? 1 : 0 }}
              >
                <img src={s.img} alt="" className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-[oklch(0.16_0.07_265)]/95 via-[oklch(0.16_0.07_265)]/40 to-transparent" />
              </div>
            ))}

            {/* Brand chip */}
            <div className="absolute top-6 left-6 flex items-center gap-3 bg-white/15 backdrop-blur-md rounded-full pl-2 pr-4 py-1.5 text-white">
              <ZennithStar size={28} spin />
              <div className="leading-tight">
                <div className="font-bold text-sm">Zennith</div>
                <div className="text-[9px] tracking-[0.2em] opacity-80">PEAK · PERFORMANCE · STANDARDS</div>
              </div>
            </div>

            {/* Slide caption */}
            <div className="absolute bottom-0 inset-x-0 p-8 text-white">
              <p className="text-[10px] tracking-[0.25em] text-white/70 uppercase">About us</p>
              <h2 className="text-3xl lg:text-4xl font-bold mt-2 leading-tight">
                {current.title.split(" ").slice(0, -1).join(" ")}{" "}
                <span className="italic text-[oklch(0.85_0.13_85)]">
                  {current.title.split(" ").slice(-1)}
                </span>
              </h2>
              <p className="text-sm text-white/80 mt-2 max-w-md">{current.body}</p>

              {/* Carousel controls */}
              <div className="flex items-center gap-4 mt-5">
                <button
                  onClick={() => setSlide((s) => (s - 1 + SLIDES.length) % SLIDES.length)}
                  className="w-9 h-9 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center backdrop-blur"
                  aria-label="Previous"
                >
                  <ChevronLeft size={16} />
                </button>
                <div className="flex gap-1.5">
                  {SLIDES.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => setSlide(i)}
                      aria-label={`Go to slide ${i + 1}`}
                      className={`h-1.5 rounded-full transition-all ${i === slide ? "w-8 bg-white" : "w-1.5 bg-white/40"}`}
                    />
                  ))}
                </div>
                <button
                  onClick={() => setSlide((s) => (s + 1) % SLIDES.length)}
                  className="w-9 h-9 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center backdrop-blur"
                  aria-label="Next"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          </div>

          {/* RIGHT — form */}
          <div className="p-8 lg:p-12 flex flex-col justify-center">
            <div className="md:hidden flex items-center gap-2 mb-6">
              <ZennithStar size={36} spin />
              <span className="font-bold text-lg">Zennith</span>
            </div>

            <h2 className="text-2xl lg:text-3xl font-bold tracking-tight">Welcome back</h2>
            <p className="text-sm text-muted-foreground mt-1 mb-8">
              Sign in to continue to your dashboard.
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-xs tracking-wider text-muted-foreground block mb-1.5 uppercase">username</label>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="username"
                  className="w-full px-3 py-2.5 border rounded-md outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)] transition"
                  required
                />
              </div>
              <div>
                <label className="text-xs tracking-wider text-muted-foreground block mb-1.5 uppercase">Password</label>
                <div className="relative">
                  <input
                    type={show ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="password"
                    className="w-full px-3 py-2.5 pr-10 border rounded-md outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)] transition"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShow((v) => !v)}
                    aria-label={show ? "Hide password" : "Show password"}
                    className="absolute inset-y-0 right-0 px-3 text-muted-foreground hover:text-foreground"
                  >
                    {show ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {(() => {
                const u = username.trim().toLowerCase();
                const rolesNeedingClinic = ["pharmacist", "admin", "doctor"];
                const needsClinic = rolesNeedingClinic.some((r) => u.includes(r));
                if (!needsClinic) return null;
                return (
                  <div>
                    <label className="text-xs tracking-wider text-muted-foreground block mb-1.5 uppercase flex items-center gap-1.5">
                      <Building2 size={12} /> Active clinic
                    </label>
                    <select
                      value={clinic}
                      onChange={(e) => setClinic(e.target.value as ClinicId)}
                      className="w-full px-3 py-2.5 border rounded-md outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)] bg-white"
                    >
                      {CLINICS.map((c) => (
                        <option key={c.id} value={c.id}>{c.name} — {c.area}</option>
                      ))}
                    </select>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Choose the clinic workspace you're signing in to.
                    </p>
                  </div>
                );
              })()}

              {error && <p className="text-sm text-destructive">{error}</p>}

              <div className="flex items-center justify-between text-sm">
                <label className="flex items-center gap-2 text-muted-foreground">
                  <input type="checkbox" className="rounded" /> Remember me
                </label>
                <Link to="/forgot-password" className="text-[oklch(0.55_0.18_245)] hover:underline">
                  Forgot password?
                </Link>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-[oklch(0.18_0.06_260)] text-white py-3 rounded-md font-medium hover:bg-[oklch(0.25_0.08_260)] transition disabled:opacity-60"
              >
                {loading ? "Signing in..." : "Sign in →"}
              </button>

              <p className="text-sm text-center text-muted-foreground pt-2">
                New here?{" "}
                <Link to="/signup" className="text-[oklch(0.55_0.18_245)] font-medium hover:underline">
                  Create an account
                </Link>
              </p>
              <p className="text-sm text-center">
                <Link to="/" className="text-muted-foreground hover:text-foreground">← Back to home</Link>
              </p>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Github } from "lucide-react";
import { ZennithStar } from "@/components/ZennithStar";
import { LandingPatientAssistant } from "@/components/LandingPatientAssistant";
import { listClinics, usePublicQueueSummary } from "@/lib/clinic-data";
import { useNow } from "@/lib/store";
import { Mail, MapPin, Plus, Minus } from "lucide-react";
import clinicPhoto from "@/assets/hero-clinic-2.jpg";
import clinicPhotoWide from "@/assets/hero-clinic-1.jpg";
import clinicPhotoThird from "@/assets/hero-clinic-3.jpg";

export const Route = createFileRoute("/")({
  component: Home,
  head: () => ({
    meta: [
      { title: "Zennith — clinic software for South Africa" },
      {
        name: "description",
        content:
          "Zennith connects patients, nurses, doctors, pharmacists and reception staff on one system — live queues, medication stock and patient records, built for South African clinics.",
      },
      {
        property: "og:title",
        content: "Zennith — clinic software for South Africa",
      },
      {
        property: "og:description",
        content:
          "See how long the queue is before you travel. One shared system for everyone who works in a clinic.",
      },
    ],
  }),
});

const FAQ: { q: string; a: string }[] = [
  {
    q: "What does Zennith actually do?",
    a: "It replaces the paper and the separate spreadsheets a clinic runs on. Reception books appointments and manages the queue, nurses and doctors open a patient's file, pharmacists track medication stock and send it to clinics, and patients see their own records and appointments. Everyone works from the same information instead of phoning each other to check.",
  },
  {
    q: "Can I see how busy a clinic is before I go?",
    a: "Yes — that's the live queue at the top of this page. Choose a clinic and you'll see how many people are waiting, how many are being seen, and roughly how long people have waited today. It updates as the clinic works.",
  },
  {
    q: "Who can see my medical record?",
    a: "Clinical staff at the clinic treating you. You control whether details like your ID number, contact details and home address are visible to them, from the Privacy page in your account. Diagnoses, medication and allergies stay visible to the staff treating you, because hiding those could put you at risk.",
  },
  {
    q: "Does it work when the internet goes down?",
    a: "Mostly. Staff can keep opening patient records and schedules already loaded on the device, and notes they write are saved and sent automatically once the connection returns. A few things genuinely need a connection — dispensing medication, booking, and creating accounts — because the server has to confirm them. Those say so clearly rather than failing quietly.",
  },
  {
    q: "How does a clinic join?",
    a: "Apply from this page. A Zennith administrator checks the clinic's registration details, then approves it and creates the first administrator account. That person adds their own staff. Public and private clinics both use the same process.",
  },
  {
    q: "What does it cost?",
    a: "Patients are never charged. Private clinics pay a monthly subscription that covers hosting, support and maintenance. Pricing for public facilities is being worked out with the people who would fund it.",
  },
];

function Home() {
  const now = useNow(60_000);

  return (
    <div className="min-h-screen bg-[oklch(0.95_0.014_250)] text-[oklch(0.18_0.05_260)]">
      <SiteHeader />
      <Hero />
      {/* Section backgrounds alternate for rhythm: light (page), white,
          navy, light, navy, white, light — then a navy footer. */}
      <Roles />
      <Joining />
      <About />
      <Team />
      <Questions />
      <Contact />
      <LandingPatientAssistant />

      <footer className="bg-[oklch(0.16_0.07_265)]">
        <div className="mx-auto max-w-6xl px-6 py-8 flex flex-wrap items-center gap-4 text-sm text-white/60">
          <ZennithStar size={24} />
          <span>Zennith Health Services</span>
          <span className="ml-auto">
            © {now.getFullYear()} · Built at the University of Johannesburg
          </span>
        </div>
      </footer>
    </div>
  );
}

function SiteHeader() {
  const [open, setOpen] = useState(false);
  const links: [string, string][] = [
    ["#what", "What it does"],
    ["#joining", "For clinics"],
    ["#team", "Team"],
    ["#questions", "Questions"],
  ];

  return (
    <header className="sticky top-0 z-40 bg-[oklch(0.95_0.014_250)]/90 backdrop-blur border-b border-[oklch(0.9_0.01_250)]">
      <div className="mx-auto max-w-6xl px-6 h-16 flex items-center gap-3">
        <a href="#top" className="flex items-center gap-2.5 shrink-0">
          <ZennithStar size={30} />
          <span className="font-semibold tracking-tight">Zennith</span>
        </a>

        <nav className="hidden md:flex items-center gap-6 ml-8 text-sm">
          {links.map(([href, label]) => (
            <a
              key={href}
              href={href}
              className="text-[oklch(0.45_0.03_260)] hover:text-[oklch(0.18_0.05_260)]"
            >
              {label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <Link
            to="/login"
            className="text-sm px-4 py-2 rounded-md hover:bg-white"
          >
            Sign in
          </Link>
          <Link
            to="/signup"
            className="text-sm px-4 py-2 rounded-md bg-[oklch(0.22_0.07_260)] text-white hover:bg-[oklch(0.3_0.08_260)] active:scale-[0.97] transition"
          >
            Create account
          </Link>
          <button
            onClick={() => setOpen((v) => !v)}
            className="md:hidden p-2 -mr-2"
            aria-label="Menu"
            aria-expanded={open}
          >
            <span className="block w-5 h-0.5 bg-current mb-1" />
            <span className="block w-5 h-0.5 bg-current mb-1" />
            <span className="block w-5 h-0.5 bg-current" />
          </button>
        </div>
      </div>

      {open && (
        <nav className="md:hidden border-t border-[oklch(0.9_0.01_250)] px-6 py-3 flex flex-col gap-3 text-sm">
          {links.map(([href, label]) => (
            <a key={href} href={href} onClick={() => setOpen(false)}>
              {label}
            </a>
          ))}
        </nav>
      )}
    </header>
  );
}

/* The hero leads with the live queue rather than a photograph: waiting is the
 * thing this product is about, and these are real numbers from a real clinic
 * rather than an illustration of one. */
function Hero() {
  return (
    <section id="top" className="relative overflow-hidden">
      {/* A photograph sits behind the headline rather than beside it: the
          words stay the loudest thing on the page, but the clinic is present
          instead of implied. Faded hard on the right so the live queue card
          keeps a clean, high-contrast background. */}
      <div aria-hidden className="absolute inset-0 -z-10">
        <img
          src={clinicPhotoThird}
          alt=""
          className="h-full w-full object-cover object-[35%_center] opacity-[0.16]"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[oklch(0.95_0.014_250)]/70 via-[oklch(0.95_0.014_250)]/85 to-[oklch(0.95_0.014_250)]" />
      </div>

      <div className="mx-auto max-w-6xl px-6 pt-16 pb-20 grid lg:grid-cols-[1.05fr_1fr] gap-12 lg:gap-16 items-center">
        <div className="animate-fade-up">
          <h1 className="font-serif text-[2.6rem] leading-[1.08] sm:text-6xl sm:leading-[1.05] tracking-tight">
            Nobody should spend
            <br />a whole day waiting
            <br />
            to be seen.
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-[oklch(0.42_0.03_260)] max-w-[52ch]">
            Zennith puts a clinic&apos;s queue, patient records, appointments
            and medication stock on one shared system — so staff stop chasing
            paper, and you can check how busy a clinic is before you travel
            there.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              to="/signup"
              className="px-5 py-3 rounded-md bg-[oklch(0.22_0.07_260)] text-white font-medium hover:bg-[oklch(0.3_0.08_260)] active:scale-[0.97] transition"
            >
              Create a patient account
            </Link>
            <Link
              to="/clinic-signup"
              className="px-5 py-3 rounded-md border border-[oklch(0.85_0.02_255)] font-medium hover:bg-white active:scale-[0.97] transition"
            >
              Register a clinic
            </Link>
          </div>
        </div>

        {/* Slightly later than the headline: one page-load sequence, rather
            than something that animates on every section. */}
        <div className="animate-fade-up [animation-delay:140ms]">
          <PublicQueue />
        </div>
      </div>
    </section>
  );
}

/* What each person actually gets. A list with rules rather than a grid of
 * identical cards — the roles aren't equivalent, and a patient reading this
 * cares about one row, not all five. */
function Roles() {
  const rows: { who: string; line: string; points: string[] }[] = [
    {
      who: "Patients",
      line: "See where you stand before you leave the house.",
      points: [
        "Live queue and typical wait at each clinic",
        "Your own records, appointments and medication",
        "Control over which personal details staff can see",
      ],
    },
    {
      who: "Reception",
      line: "Run the queue without guessing who's next.",
      points: [
        "Guided triage questions instead of judging urgency alone",
        "Clear position, waiting time and who each patient is seeing",
        "A prompt when someone called hasn't arrived",
      ],
    },
    {
      who: "Nurses",
      line: "One file per patient, wherever you are in the shift.",
      points: [
        "Patient records, dispensing and dose logging",
        "Shift handover notes shared across the clinic",
        "Confirm stock deliveries and record what actually arrived",
      ],
    },
    {
      who: "Doctors",
      line: "Your day, your patients, across clinics.",
      points: [
        "Schedule and patient files in one place",
        "Switch between the clinics you work at",
        "Full history without waiting for a paper file",
      ],
    },
    {
      who: "Pharmacists",
      line: "Know what to order before you run out.",
      points: [
        "Days of stock left, based on real dispensing",
        "Reorder points and suggested quantities",
        "Send stock to clinics and see what they confirmed",
      ],
    },
  ];

  return (
    <section
      id="what"
      className="border-y border-[oklch(0.9_0.01_250)] bg-white"
    >
      <div className="mx-auto max-w-6xl px-6 py-20">
        <div className="grid lg:grid-cols-[1fr_24rem] gap-10 items-end">
          <div>
            <h2 className="font-serif text-3xl sm:text-4xl tracking-tight">
              One system, five kinds of work
            </h2>
            <p className="mt-3 text-[oklch(0.45_0.03_260)] max-w-[60ch]">
              A clinic isn&apos;t one job. Zennith gives each role the part they
              need, working off the same information.
            </p>
          </div>
          {/* Two roles working from the same thing — the point of this section. */}
          <img
            src={clinicPhoto}
            alt="A doctor and a nurse checking something together at a medicine counter"
            className="rounded-lg w-full object-cover aspect-[4/3]"
          />
        </div>

        <div className="mt-10 divide-y divide-[oklch(0.92_0.01_250)]">
          {rows.map((r) => (
            <div
              key={r.who}
              className="grid sm:grid-cols-[13rem_1fr] gap-x-8 gap-y-3 py-7"
            >
              <div>
                <h3 className="font-serif text-xl">{r.who}</h3>
                <p className="text-sm text-[oklch(0.5_0.03_260)] mt-1">
                  {r.line}
                </p>
              </div>
              <ul className="space-y-2">
                {r.points.map((p) => (
                  <li key={p} className="flex gap-3 text-[15px]">
                    <span className="mt-2 h-1 w-1 rounded-full bg-[oklch(0.65_0.15_235)] shrink-0" />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* Numbered because this genuinely is a sequence. */
function Joining() {
  const steps = [
    {
      t: "Apply",
      d: "Send your clinic's name, registration number and contact details from the registration form. Takes a few minutes.",
    },
    {
      t: "We check the details",
      d: "A Zennith administrator verifies the clinic is real and registered before anything is approved.",
    },
    {
      t: "Your administrator is set up",
      d: "The contact person gets an account and sets their own password. Nobody at Zennith ever sees it.",
    },
    {
      t: "Add your staff",
      d: "Your administrator invites doctors, nurses, pharmacists and reception. Each sets their own password by email.",
    },
  ];

  return (
    <section id="joining" className="bg-[oklch(0.16_0.07_265)] text-white">
      <div className="mx-auto max-w-6xl px-6 py-20 grid lg:grid-cols-[1fr_1.1fr] gap-12 items-start">
        <div>
          <h2 className="font-serif text-3xl sm:text-4xl tracking-tight">
            Getting a clinic onto Zennith
          </h2>
          <p className="mt-3 text-white/70 max-w-[50ch]">
            Public or private, the process is the same. Most clinics are running
            within a day of approval.
          </p>
          {/* Beside the steps that end with your own staff on the system. */}
          <img
            src={clinicPhotoThird}
            alt="Three clinic staff standing together outside their clinic"
            className="mt-8 rounded-lg w-full object-cover aspect-[4/3] hidden lg:block"
          />
        </div>

        <ol className="space-y-6">
          {steps.map((s, i) => (
            <li key={s.t} className="flex gap-5">
              <span className="font-serif text-2xl text-[oklch(0.72_0.13_245)] w-8 shrink-0 tabular-nums">
                {i + 1}
              </span>
              <div>
                <h3 className="font-medium">{s.t}</h3>
                <p className="text-[15px] text-white/70 mt-1 max-w-[55ch]">
                  {s.d}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function About() {
  return (
    <section>
      <div className="mx-auto max-w-6xl px-6 py-20 grid lg:grid-cols-2 gap-12 items-center">
        <div>
          <h2 className="font-serif text-3xl sm:text-4xl tracking-tight">
            Why we built it
          </h2>
          <div className="mt-5 space-y-4 text-[15px] leading-relaxed text-[oklch(0.42_0.03_260)] max-w-[58ch]">
            <p>
              South African clinics do extraordinary work with very little. What
              slows them down usually isn&apos;t clinical — it&apos;s a patient
              file that can&apos;t be found, stock that ran out without warning,
              or a queue nobody can see the shape of.
            </p>
            <p>
              Zennith started as a final-year Information Systems project at the
              University of Johannesburg, built with input from nurses and
              reception staff about what actually gets in their way. Every
              workflow here came from one of those conversations rather than
              from a feature list.
            </p>
            <p>
              It runs on real clinic data, keeps working when the connection
              drops, and refuses to guess when it doesn&apos;t know something —
              because in a clinic, a confident wrong answer is worse than no
              answer.
            </p>
          </div>
        </div>
        {/* Beside "built with input from nurses" — a nurse with a patient. */}
        <img
          src={clinicPhotoWide}
          alt="A nurse talking with a patient in a clinic corridor"
          className="rounded-lg w-full object-cover aspect-[3/2]"
        />
      </div>
    </section>
  );
}

/* The team. To change anything on a card, edit its entry below.
 *
 * Photos: save each person's photo in public/team/ named after `photo` below
 * (e.g. david.jpeg) — .jpeg, .jpg, .png and .webp all work, any size; it is
 * cropped into a circle automatically. No photo yet? Their initials show.
 * See public/team/README.md.
 *
 * `accent` picks the colour of the ring around the photo and the skill chips:
 * backend (blue), frontend (teal), database (gold) or lead (violet). */

// Gold is the complement of the site's blue, so names and roles lift off the
// navy instead of sitting on it as flat white. Every colour here was checked
// against the card background (including where a background glow lights it):
// all are well above the 4.5:1 contrast minimum.
const GOLD = "oklch(0.84 0.13 85)";
const NAME_COLOR = "oklch(0.97 0.01 90)";
const BIO_COLOR = "oklch(0.85 0.03 250)";
const LINK_COLOR = "oklch(0.82 0.11 200)";

const ACCENTS = {
  backend: {
    fg: "oklch(0.8 0.11 245)",
    tint: "oklch(0.8 0.11 245 / 0.14)",
    line: "oklch(0.8 0.11 245 / 0.35)",
  },
  frontend: {
    fg: "oklch(0.82 0.11 200)",
    tint: "oklch(0.82 0.11 200 / 0.14)",
    line: "oklch(0.82 0.11 200 / 0.35)",
  },
  database: {
    fg: GOLD,
    tint: "oklch(0.84 0.13 85 / 0.14)",
    line: "oklch(0.84 0.13 85 / 0.35)",
  },
  lead: {
    fg: "oklch(0.8 0.12 300)",
    tint: "oklch(0.8 0.12 300 / 0.14)",
    line: "oklch(0.8 0.12 300 / 0.35)",
  },
} as const;

interface TeamMember {
  name: string;
  role: string;
  bio: string;
  tags: string[];
  accent: keyof typeof ACCENTS;
  /** File name in public/team/, without the extension. */
  photo: string;
  /** Leave out until they have a profile to link to. */
  github?: string;
}

const TEAM_MEMBERS: TeamMember[] = [
  {
    name: "David",
    role: "Back-end developer",
    bio: "Built the doctor module, and handled troubleshooting, testing, Git control and debugging for the team. Also a lead presenter.",
    tags: ["Testing", "Git", "Presenter"],
    accent: "backend",
    photo: "/team/david",
    github: "https://github.com/Dexter-David",
  },
  {
    name: "Nombulelo",
    role: "Back-end developer",
    bio: "Built the admin and nurse modules, and helped run the project through testing and project management.",
    tags: ["Testing", "Project management"],
    accent: "backend",
    photo: "/team/nombulela",
    github: "https://github.com/nombulelo-radebe",
  },
  {
    name: "Nobuhle",
    role: "Database and back end",
    bio: "Worked on the database and the back end, and supported the front end too.",
    tags: ["Database", "Front-end support"],
    accent: "database",
    photo: "/team/nobuhle",
    github: "https://github.com/Nobuhle2405",
  },
  {
    name: "Michelle",
    role: "Database",
    bio: "Worked on the database with Firebase, and managed the Firestore security rules. Also a lead presenter.",
    tags: ["Firestore rules", "Presenter"],
    accent: "database",
    photo: "/team/michelle",
  },
  {
    name: "Simbarashe",
    role: "Front-end lead developer",
    bio: "Led the front end, and debugged and troubleshot problems for the whole group.",
    tags: ["Debugging", "Troubleshooting"],
    accent: "frontend",
    photo: "/team/simba",
    github: "https://github.com/SimbaZero",
  },
  {
    name: "Chiedza",
    role: "Project manager and group leader",
    bio: "Led the group as project manager. Built the logins, helped with the database, and facilitated debugging and thorough testing.",
    tags: ["Testing", "Debugging", "Database"],
    accent: "lead",
    photo: "/team/chieta",
    github: "https://github.com/cmutizwa",
  },
  {
    name: "Olerato",
    role: "Back-end developer",
    bio: "Built the chatbot and the receptionist module on the back end, with debugging and testing.",
    tags: ["Testing", "Debugging"],
    accent: "backend",
    photo: "/team/olerato",
    github: "https://github.com/diamondmalefo",
  },
  {
    name: "Ndaedzo",
    role: "Back-end developer",
    bio: "Built the pharmacist module on the back end, and handled debugging, testing and Git control across the project.",
    tags: ["Testing", "Debugging", "Git"],
    accent: "backend",
    photo: "/team/ndaedzo",
    github: "https://github.com/Ndae777",
  },
];

/** Whichever of these the file was actually saved as, it works — no need to
 *  convert or rename to match a specific extension. Ordered by what phones and
 *  Ubuntu most often produce, so the first guess usually lands. */
const PHOTO_EXTENSIONS = ["jpeg", "jpg", "png", "webp"];

/**
 * Finds which file actually exists for `base` (e.g. "/team/david") and returns
 * its URL, or null while looking / if none exists.
 *
 * Why this doesn't simply render an <img> and react to its onError: this page
 * is server-rendered, so an <img> in the HTML starts loading — and, for a
 * missing file, fails — before React has attached any handler to it. The
 * error is already over by the time onError could listen, so a fallback
 * driven by onError never runs. Probing from an effect only ever happens in
 * the browser, after React is ready, so nothing can be missed. Until a probe
 * succeeds the caller shows its placeholder, which is also what the server
 * sends — so there is no server/browser mismatch either.
 */
function usePhotoSrc(base: string): string | null {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let index = 0;
    setSrc(null);

    const tryNext = () => {
      if (cancelled || index >= PHOTO_EXTENSIONS.length) return;
      const candidate = `${base}.${PHOTO_EXTENSIONS[index]}`;
      const probe = new Image();
      probe.onload = () => {
        if (!cancelled) setSrc(candidate);
      };
      probe.onerror = () => {
        index += 1;
        tryNext();
      };
      probe.src = candidate;
    };
    tryNext();

    return () => {
      cancelled = true;
    };
  }, [base]);

  return src;
}

/** A team photo, or the person's initials on a solid colour until one is
 *  found — so a photo that hasn't been added yet looks intentional, not
 *  broken. */
function TeamAvatar({ name, base }: { name: string; base: string }) {
  const src = usePhotoSrc(base);
  const initials =
    name
      .trim()
      .split(/\s+/)
      .map((w) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?";

  if (!src) {
    return (
      <div
        className="w-36 h-36 sm:w-40 sm:h-40 rounded-full bg-[oklch(0.22_0.07_262)] flex items-center justify-center font-serif text-4xl"
        style={{ color: GOLD }}
      >
        {initials}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={name}
      className="w-36 h-36 sm:w-40 sm:h-40 rounded-full object-cover bg-[oklch(0.22_0.07_262)]"
    />
  );
}

/** The team's own group photo (public/team/group-photo, any extension above)
 *  — wide works best. Shows a plain gradient panel with the same message
 *  until it's found, rather than a broken image. */
function TeamPortrait() {
  const src = usePhotoSrc("/team/group-photo");
  // The thank-you arrives as the panel does, once — it's the last thing on the
  // page, so animating it on mount would mean nobody ever sees it happen.
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [arrived, setArrived] = useState(false);

  useEffect(() => {
    if (arrived) return;
    const el = panelRef.current;
    if (!el) return;
    // No observer (older browser, or the server-rendered pass) — show the
    // finished state rather than leaving the caption hidden.
    if (typeof IntersectionObserver === "undefined") {
      setArrived(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setArrived(true);
          observer.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    observer.observe(el);
    return () => observer.disconnect();
    // `src` is a dependency because the panel element is replaced when the
    // photo resolves — the observer has to move to the new one.
  }, [src, arrived]);

  // Every hidden and transition class is motion-safe:, so a device asking for
  // reduced motion renders the final state with nothing moving or fading.
  const rise = arrived
    ? "motion-safe:opacity-100 motion-safe:translate-y-0"
    : "motion-safe:opacity-0 motion-safe:translate-y-4";

  const caption = (
    <div className="absolute inset-x-0 bottom-0 p-6 sm:p-8">
      {/* The observer is what reveals the caption, so without scripting it
          would never arrive. Show it outright in that case. */}
      <noscript>
        <style>{`.thank-you-line { opacity: 1 !important; translate: none !important; }`}</style>
      </noscript>
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-x-0 bottom-0 h-48 motion-safe:transition-opacity motion-safe:duration-[1600ms] ${
          arrived ? "opacity-100" : "motion-safe:opacity-0"
        }`}
        style={{
          background:
            "radial-gradient(55% 120% at 18% 100%, oklch(0.84 0.13 85 / 0.22), transparent 70%)",
        }}
      />
      <p
        className={`thank-you-line relative font-serif text-2xl sm:text-3xl text-white motion-safe:transition-all motion-safe:duration-700 motion-safe:ease-out ${rise}`}
      >
        <span
          className="text-3xl sm:text-4xl align-baseline"
          style={{ color: GOLD }}
        >
          Thank you
        </span>{" "}
        for visiting Zennith
      </p>
      <p
        className={`thank-you-line relative mt-1 text-white/70 text-sm motion-safe:transition-all motion-safe:duration-700 motion-safe:ease-out motion-safe:delay-300 ${rise}`}
      >
        From all eight of us — we hope it makes a clinic's day a little easier.
      </p>
    </div>
  );

  if (!src) {
    return (
      <div
        ref={panelRef}
        className="relative mt-12 rounded-xl overflow-hidden aspect-[16/7] bg-gradient-to-br from-[oklch(0.22_0.1_255)] to-[oklch(0.16_0.07_265)]"
      >
        {caption}
      </div>
    );
  }
  return (
    <div
      ref={panelRef}
      className="relative mt-12 rounded-xl overflow-hidden aspect-[16/7]"
    >
      <img
        src={src}
        alt="The Zennith team"
        className="absolute inset-0 w-full h-full object-cover"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
      {caption}
    </div>
  );
}

function Team() {
  return (
    <section
      id="team"
      className="relative overflow-hidden bg-gradient-to-br from-[oklch(0.16_0.07_265)] via-[oklch(0.19_0.09_260)] to-[oklch(0.16_0.07_265)] text-white"
    >
      {/* The same glow used behind every auth page (AuthBackground) —
          one recognisable Zennith moment, not a different effect per page. */}
      <div aria-hidden className="absolute inset-0">
        <div className="absolute -top-24 -left-24 w-[26rem] h-[26rem] rounded-full bg-[oklch(0.55_0.18_245)] opacity-20 blur-3xl animate-blob-1" />
        <div className="absolute -bottom-24 -right-24 w-[28rem] h-[28rem] rounded-full bg-[oklch(0.5_0.2_290)] opacity-15 blur-3xl animate-blob-2" />
        <div className="absolute top-1/2 left-1/2 w-64 h-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[oklch(0.7_0.18_200)] opacity-10 blur-3xl animate-blob-3" />
      </div>

      <div className="relative mx-auto max-w-6xl px-6 py-20">
        <h2 className="font-serif text-3xl sm:text-4xl tracking-tight">
          The people who built it
        </h2>
        <p className="mt-3 text-white/70 max-w-[60ch]">
          Eight final-year Information Systems students at the University of
          Johannesburg.
        </p>

        <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-7">
          {TEAM_MEMBERS.map((m) => {
            const accent = ACCENTS[m.accent];
            return (
              <div
                key={m.name}
                className="group relative flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm p-7 text-center transition-all duration-300 ease-out hover:-translate-y-1.5 hover:bg-white/[0.08] hover:border-white/20 hover:shadow-2xl hover:shadow-black/30"
              >
                {/* A thread of the member's own accent along the top edge, so
                    the four cards read as a set without any of them changing
                    size or weight. */}
                <span
                  aria-hidden
                  className="absolute inset-x-0 top-0 h-[2px]"
                  style={{
                    background: `linear-gradient(90deg, transparent, ${accent.fg}, transparent)`,
                  }}
                />
                <div className="relative mx-auto w-fit">
                  {/* Soft glow in the accent colour, behind the portrait —
                      brightens on hover rather than moving anything. */}
                  <span
                    aria-hidden
                    className="absolute -inset-3 rounded-full blur-2xl opacity-30 transition-opacity duration-300 group-hover:opacity-55"
                    style={{ background: accent.fg }}
                  />
                  <div
                    className="relative rounded-full p-[3px]"
                    style={{
                      background: `linear-gradient(135deg, ${GOLD}, ${accent.fg})`,
                    }}
                  >
                    <TeamAvatar name={m.name} base={m.photo} />
                  </div>
                </div>
                <p
                  className="mt-5 text-xl font-medium"
                  style={{ color: NAME_COLOR }}
                >
                  {m.name}
                </p>
                <p className="mt-1 text-sm font-medium" style={{ color: GOLD }}>
                  {m.role}
                </p>
                <p
                  className="mt-3 text-sm leading-relaxed"
                  style={{ color: BIO_COLOR }}
                >
                  {m.bio}
                </p>
                <ul className="mt-4 flex flex-wrap justify-center gap-1.5">
                  {m.tags.map((tag) => (
                    <li
                      key={tag}
                      className="rounded-full border px-2.5 py-1 text-xs"
                      style={{
                        color: accent.fg,
                        backgroundColor: accent.tint,
                        borderColor: accent.line,
                      }}
                    >
                      {tag}
                    </li>
                  ))}
                </ul>
                {m.github && (
                  <div className="mt-auto pt-5">
                    <a
                      href={m.github}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`${m.name} on GitHub`}
                      className="inline-flex items-center gap-1.5 text-sm hover:underline"
                      style={{ color: LINK_COLOR }}
                    >
                      <Github size={15} /> GitHub
                    </a>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <TeamPortrait />
      </div>
    </section>
  );
}

function Questions() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section
      id="questions"
      className="border-y border-[oklch(0.9_0.01_250)] bg-white"
    >
      <div className="mx-auto max-w-3xl px-6 py-20">
        <h2 className="font-serif text-3xl sm:text-4xl tracking-tight">
          Questions people ask
        </h2>

        <div className="mt-8 divide-y divide-[oklch(0.92_0.01_250)] border-t border-[oklch(0.92_0.01_250)]">
          {FAQ.map((item, i) => {
            const isOpen = open === i;
            return (
              <div key={item.q}>
                <button
                  onClick={() => setOpen(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  className="w-full flex items-start gap-4 py-5 text-left"
                >
                  <span className="font-medium flex-1">{item.q}</span>
                  {isOpen ? (
                    <Minus
                      size={18}
                      className="mt-0.5 shrink-0 text-[oklch(0.55_0.04_260)]"
                    />
                  ) : (
                    <Plus
                      size={18}
                      className="mt-0.5 shrink-0 text-[oklch(0.55_0.04_260)]"
                    />
                  )}
                </button>
                {isOpen && (
                  <p className="pb-6 pr-8 text-[15px] leading-relaxed text-[oklch(0.42_0.03_260)]">
                    {item.a}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function Contact() {
  return (
    <section id="contact" className="mx-auto max-w-6xl px-6 py-20">
      <div className="grid lg:grid-cols-[1fr_1fr] gap-12">
        <div>
          <h2 className="font-serif text-3xl sm:text-4xl tracking-tight">
            Talk to us
          </h2>
          <p className="mt-3 text-[oklch(0.45_0.03_260)] max-w-[50ch]">
            Whether you run a clinic, work in one, or want to know how the
            system was built — we&apos;ll answer.
          </p>

          <div className="mt-8 space-y-4 text-[15px]">
            <a
              href="mailto:hello@zennith.co.za"
              className="flex items-center gap-3 hover:text-[oklch(0.45_0.15_245)]"
            >
              <Mail size={17} className="text-[oklch(0.55_0.04_260)]" />
              hello@zennith.co.za
            </a>
            <p className="flex items-center gap-3 text-[oklch(0.45_0.03_260)]">
              <MapPin size={17} className="text-[oklch(0.55_0.04_260)]" />
              Johannesburg, South Africa
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-[oklch(0.88_0.015_250)] bg-white p-7">
          <h3 className="font-serif text-xl">Ready to start?</h3>
          <p className="text-[15px] text-[oklch(0.45_0.03_260)] mt-2">
            Patients can create an account now. Clinics apply and hear back once
            we&apos;ve checked the registration details.
          </p>
          <div className="mt-5 flex flex-col gap-2.5">
            <Link
              to="/signup"
              className="px-5 py-3 rounded-md bg-[oklch(0.22_0.07_260)] text-white font-medium text-center hover:bg-[oklch(0.3_0.08_260)] active:scale-[0.97] transition"
            >
              Create a patient account
            </Link>
            <Link
              to="/clinic-signup"
              className="px-5 py-3 rounded-md border border-[oklch(0.85_0.02_255)] font-medium text-center hover:bg-[oklch(0.97_0.005_250)] active:scale-[0.97] transition"
            >
              Register a clinic
            </Link>
            <Link
              to="/login"
              className="px-5 py-3 rounded-md font-medium text-center hover:bg-[oklch(0.96_0.01_250)]"
            >
              Sign in to your dashboard
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

/* Live queue — real data, public and anonymous: counts only, never a name.
 * Carried over from the previous landing page and restyled for the hero. */
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
    <div className="rounded-xl bg-[oklch(0.16_0.07_265)] text-white p-6 sm:p-8">
      <div className="flex items-center gap-3">
        <span className="relative flex h-2 w-2" aria-hidden>
          <span className="absolute inline-flex h-full w-full rounded-full bg-[oklch(0.78_0.15_160)] opacity-60 motion-safe:animate-ping" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-[oklch(0.78_0.15_160)]" />
        </span>
        <span className="text-sm text-white/70">Live right now</span>
        <button
          onClick={findNearest}
          disabled={locating}
          className="ml-auto text-xs border border-white/25 hover:bg-white/10 rounded-full px-3 py-1.5 disabled:opacity-50"
        >
          {locating ? "Locating…" : "Nearest to me"}
        </button>
      </div>

      <select
        value={clinicId ?? ""}
        onChange={(e) => setSelected(Number(e.target.value))}
        aria-label="Choose a clinic"
        className="mt-5 w-full bg-white/10 border border-white/20 rounded-md px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-white/40"
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
      {locError && <p className="text-xs text-white/50 mt-2">{locError}</p>}

      {summary.loading ? (
        <p className="text-sm text-white/60 py-14 text-center">Loading…</p>
      ) : (
        <>
          <div className="mt-6">
            {summary.avgWaitMin != null ? (
              <>
                {/* Amber appears only on time — the one thing this product is
                    really about — so the colour carries meaning. */}
                <p className="font-serif text-7xl leading-none tabular-nums text-[oklch(0.85_0.13_85)]">
                  {summary.avgWaitMin}
                  <span className="text-2xl ml-2 font-sans text-white/70">
                    min
                  </span>
                </p>
                <p className="text-sm text-white/60 mt-2">
                  typical wait today, from visits already finished
                </p>
              </>
            ) : (
              <p className="text-sm text-white/60 py-6">
                Not enough visits finished today to estimate a wait yet.
              </p>
            )}
          </div>

          <div className="mt-7 pt-6 border-t border-white/15 grid grid-cols-2 gap-6">
            <div>
              <p className="text-3xl tabular-nums">{summary.waiting}</p>
              <p className="text-sm text-white/60 mt-1">waiting</p>
            </div>
            <div>
              <p className="text-3xl tabular-nums">{summary.inProgress}</p>
              <p className="text-sm text-white/60 mt-1">being seen</p>
            </div>
          </div>

          <p className="text-xs text-white/45 mt-6">
            Counts only — no patient information is shown here.
          </p>
        </>
      )}
    </div>
  );
}

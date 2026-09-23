import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ZennithStar } from "@/components/ZennithStar";
import { listClinics, usePublicQueueSummary } from "@/lib/clinic-data";
import { useNow } from "@/lib/store";
import { Github, Linkedin, Mail, MapPin, Plus, Minus } from "lucide-react";
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

/* ---------------------------------------------------------------------------
 * Team.
 *
 * Roles are deliberately blank for now — each member fills in their own at the
 * next meeting, rather than having one written for them. The GitHub and
 * LinkedIn icons only render once a real URL is set, so the page never shows
 * a link that goes nowhere.
 * ------------------------------------------------------------------------- */
type Member = {
  name: string;
  role: string;
  blurb: string;
  github?: string;
  linkedin?: string;
  photo?: string;
};

const TEAM: Member[] = [
  { name: "Chiedza Tinotenda Mutizwa", role: "", blurb: "" },
  { name: "Ndaedzo Nkhumeleni", role: "", blurb: "" },
  { name: "Simbarashe Gandi", role: "", blurb: "" },
  { name: "Nombulelo Radebe", role: "", blurb: "" },
  { name: "Katlego Esther Michelle Setsome", role: "", blurb: "" },
  { name: "Nobuhle Lebani Ndlovu", role: "", blurb: "" },
  { name: "Olorato", role: "", blurb: "" },
  { name: "David Ogo Oluwa Adebayo", role: "", blurb: "" },
];

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0])
    .join("")
    .toUpperCase();

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
    <div className="min-h-screen bg-[oklch(0.985_0.005_240)] text-[oklch(0.18_0.05_260)]">
      <SiteHeader />
      <Hero />
      <Roles />
      <PhotoBand />
      <Joining />
      <About />
      <Team />
      <Questions />
      <Contact />

      <footer className="border-t border-[oklch(0.9_0.01_250)]">
        <div className="mx-auto max-w-6xl px-6 py-8 flex flex-wrap items-center gap-4 text-sm text-[oklch(0.5_0.03_260)]">
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
    <header className="sticky top-0 z-40 bg-[oklch(0.985_0.005_240)]/90 backdrop-blur border-b border-[oklch(0.9_0.01_250)]">
      <div className="mx-auto max-w-6xl px-6 h-16 flex items-center gap-3">
        <a href="#top" className="flex items-center gap-2.5 shrink-0">
          <ZennithStar size={30} />
          <span className="font-semibold tracking-tight">Zennith</span>
        </a>

        <nav className="hidden md:flex items-center gap-6 ml-8 text-sm">
          {links.map(([href, label]) => (
            <a key={href}
              href={href}
              className="text-[oklch(0.45_0.03_260)] hover:text-[oklch(0.18_0.05_260)]"
            >
              {label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <Link to="/login"
            className="text-sm px-4 py-2 rounded-md hover:bg-[oklch(0.94_0.01_250)]"
          >
            Sign in
          </Link>
          <Link to="/signup"
            className="text-sm px-4 py-2 rounded-md bg-[oklch(0.22_0.07_260)] text-white hover:bg-[oklch(0.3_0.08_260)]"
          >
            Create account
          </Link>
          <button onClick={() => setOpen((v) => !v)}
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
        <img src={clinicPhotoThird}
          alt=""
          className="h-full w-full object-cover object-[35%_center] opacity-[0.16]"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[oklch(0.985_0.005_240)]/70 via-[oklch(0.985_0.005_240)]/85 to-[oklch(0.985_0.005_240)]" />
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
            <Link to="/signup"
              className="px-5 py-3 rounded-md bg-[oklch(0.22_0.07_260)] text-white font-medium hover:bg-[oklch(0.3_0.08_260)]"
            >
              Create a patient account
            </Link>
            <Link to="/clinic-signup"
              className="px-5 py-3 rounded-md border border-[oklch(0.85_0.02_255)] font-medium hover:bg-white"
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
    <section id="what"
      className="border-y border-[oklch(0.9_0.01_250)] bg-white"
    >
      <div className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="font-serif text-3xl sm:text-4xl tracking-tight">
          One system, five kinds of work
        </h2>
        <p className="mt-3 text-[oklch(0.45_0.03_260)] max-w-[60ch]">
          A clinic isn&apos;t one job. Zennith gives each role the part they
          need, working off the same information.
        </p>

        <div className="mt-10 divide-y divide-[oklch(0.92_0.01_250)]">
          {rows.map((r) => (
            <div key={r.who}
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

/* A full-width band of the clinics themselves, between the abstract role list
 * and the joining steps — it breaks up two text-heavy sections and puts the
 * actual setting on the page. */
function PhotoBand() {
  const shots = [
    { src: clinicPhotoWide, caption: "Reception and triage" },
    { src: clinicPhoto, caption: "Consultation rooms" },
    { src: clinicPhotoThird, caption: "Dispensary and stock" },
  ];
  return (
    <section aria-hidden className="mx-auto max-w-6xl px-6 py-14">
      <div className="grid sm:grid-cols-3 gap-4">
        {shots.map((shot) => (
          <figure key={shot.caption} className="relative">
            <img src={shot.src}
              alt=""
              className="w-full aspect-[4/3] object-cover rounded-lg"
            />
            <figcaption className="absolute bottom-0 inset-x-0 p-3 text-xs text-white rounded-b-lg bg-gradient-to-t from-black/65 to-transparent">
              {shot.caption}
            </figcaption>
          </figure>
        ))}
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
    <section id="joining" className="mx-auto max-w-6xl px-6 py-20">
      <div className="grid lg:grid-cols-[1fr_1.1fr] gap-12 items-start">
        <div>
          <h2 className="font-serif text-3xl sm:text-4xl tracking-tight">
            Getting a clinic onto Zennith
          </h2>
          <p className="mt-3 text-[oklch(0.45_0.03_260)] max-w-[50ch]">
            Public or private, the process is the same. Most clinics are running
            within a day of approval.
          </p>
          <img src={clinicPhoto}
            alt=""
            className="mt-8 rounded-lg w-full object-cover aspect-[4/3] hidden lg:block"
          />
        </div>

        <ol className="space-y-6">
          {steps.map((s, i) => (
            <li key={s.t} className="flex gap-5">
              <span className="font-serif text-2xl text-[oklch(0.65_0.15_235)] w-8 shrink-0 tabular-nums">
                {i + 1}
              </span>
              <div>
                <h3 className="font-medium">{s.t}</h3>
                <p className="text-[15px] text-[oklch(0.45_0.03_260)] mt-1 max-w-[55ch]">
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
    <section className="bg-[oklch(0.16_0.07_265)] text-white">
      <div className="mx-auto max-w-6xl px-6 py-20 grid lg:grid-cols-2 gap-12 items-center">
        <div>
          <h2 className="font-serif text-3xl sm:text-4xl tracking-tight">
            Why we built it
          </h2>
          <div className="mt-5 space-y-4 text-[15px] leading-relaxed text-white/75 max-w-[58ch]">
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
        <img src={clinicPhotoWide}
          alt=""
          className="rounded-lg w-full object-cover aspect-[3/2]"
        />
      </div>
    </section>
  );
}

function Team() {
  return (
    <section id="team" className="mx-auto max-w-6xl px-6 py-20">
      <h2 className="font-serif text-3xl sm:text-4xl tracking-tight">
        The people who built it
      </h2>
      <p className="mt-3 text-[oklch(0.45_0.03_260)] max-w-[60ch]">
        Eight final-year Information Systems students at the University of
        Johannesburg.
      </p>

      <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-10">
        {TEAM.map((m) => (
          <article key={m.name}>
            {m.photo ? (
              <img src={m.photo}
                alt=""
                className="w-full aspect-square object-cover rounded-full"
              />
            ) : (
              <div className="w-full aspect-square rounded-full bg-[oklch(0.93_0.02_250)] grid place-items-center">
                <span className="font-serif text-3xl text-[oklch(0.55_0.06_260)]">
                  {initials(m.name)}
                </span>
              </div>
            )}

            <h3 className="mt-4 font-medium leading-snug">{m.name}</h3>
            <p className="text-sm text-[oklch(0.5_0.03_260)] mt-0.5">
              {m.role || "Role to be confirmed"}
            </p>
            {m.blurb && (
              <p className="text-sm text-[oklch(0.45_0.03_260)] mt-2 leading-relaxed">
                {m.blurb}
              </p>
            )}

            {(m.github || m.linkedin) && (
              <div className="flex gap-3 mt-3">
                {m.github && (
                  <a href={m.github}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[oklch(0.5_0.03_260)] hover:text-[oklch(0.18_0.05_260)]"
                    aria-label={`${m.name} on GitHub`}
                  >
                    <Github size={17} />
                  </a>
                )}
                {m.linkedin && (
                  <a href={m.linkedin}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[oklch(0.5_0.03_260)] hover:text-[oklch(0.18_0.05_260)]"
                    aria-label={`${m.name} on LinkedIn`}
                  >
                    <Linkedin size={17} />
                  </a>
                )}
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function Questions() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="questions"
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
                <button onClick={() => setOpen(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  className="w-full flex items-start gap-4 py-5 text-left"
                >
                  <span className="font-medium flex-1">{item.q}</span>
                  {isOpen ? (
                    <Minus size={18}
                      className="mt-0.5 shrink-0 text-[oklch(0.55_0.04_260)]"
                    />
                  ) : (
                    <Plus size={18}
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
            <a href="mailto:hello@zennith.co.za"
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
            <Link to="/signup"
              className="px-5 py-3 rounded-md bg-[oklch(0.22_0.07_260)] text-white font-medium text-center hover:bg-[oklch(0.3_0.08_260)]"
            >
              Create a patient account
            </Link>
            <Link to="/clinic-signup"
              className="px-5 py-3 rounded-md border border-[oklch(0.85_0.02_255)] font-medium text-center hover:bg-[oklch(0.97_0.005_250)]"
            >
              Register a clinic
            </Link>
            <Link to="/login"
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
        <button onClick={findNearest}
          disabled={locating}
          className="ml-auto text-xs border border-white/25 hover:bg-white/10 rounded-full px-3 py-1.5 disabled:opacity-50"
        >
          {locating ? "Locating…" : "Nearest to me"}
        </button>
      </div>

      <select value={clinicId ?? ""}
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

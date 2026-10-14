import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

// A hidden credit on the landing page. Purely cosmetic: no data, no routes,
// nothing else on the page knows it exists.
//
//   - Tapping the trigger (the small star in the footer) 5 times in quick
//     succession opens a card.
//   - Tapping the card itself 7 more times, again quickly, reveals a second
//     message underneath.
//
// "Quickly" means each tap lands within TAP_GAP_MS of the one before; a pause
// starts the count again, so wandering clicks around the page can never add up
// to it. It closes with the X, a tap outside, or Escape.

const OPEN_TAPS = 5;
const DEEPER_TAPS = 7;
const TAP_GAP_MS = 600;

/** Counts a run of quick taps; calls `onReached` when the run is long enough. */
function useTapRun(needed: number, onReached: () => void) {
  const count = useRef(0);
  const last = useRef(0);
  const [progress, setProgress] = useState(0);
  const tap = () => {
    const now = Date.now();
    count.current = now - last.current <= TAP_GAP_MS ? count.current + 1 : 1;
    last.current = now;
    if (count.current >= needed) {
      count.current = 0;
      setProgress(0);
      onReached();
    } else {
      setProgress(count.current);
    }
  };
  const reset = () => {
    count.current = 0;
    last.current = 0;
    setProgress(0);
  };
  return { tap, reset, progress };
}

// Fixed positions, so the server and the browser draw the same sparkles.
const SPARKLES = [
  { left: "8%", top: "14%", size: 3, delay: "0s" },
  { left: "86%", top: "10%", size: 2, delay: "0.7s" },
  { left: "20%", top: "78%", size: 2, delay: "1.4s" },
  { left: "92%", top: "62%", size: 3, delay: "0.3s" },
  { left: "62%", top: "6%", size: 2, delay: "1.9s" },
  { left: "4%", top: "50%", size: 2, delay: "1.1s" },
  { left: "74%", top: "88%", size: 3, delay: "2.3s" },
  { left: "40%", top: "92%", size: 2, delay: "0.5s" },
];

const STYLES = `
@keyframes egg-backdrop { from { opacity: 0 } to { opacity: 1 } }
@keyframes egg-rise {
  0% { opacity: 0; transform: translateY(18px) scale(0.92) }
  60% { opacity: 1; transform: translateY(-3px) scale(1.015) }
  100% { opacity: 1; transform: translateY(0) scale(1) }
}
@keyframes egg-twinkle {
  0%, 100% { opacity: 0.15; transform: scale(0.6) }
  50% { opacity: 1; transform: scale(1.25) }
}
@keyframes egg-beat {
  0%, 100% { transform: scale(1) }
  14% { transform: scale(1.22) }
  28% { transform: scale(1) }
  42% { transform: scale(1.16) }
  56% { transform: scale(1) }
}
@keyframes egg-halo {
  0%, 100% { opacity: 0.55; transform: scale(1) }
  50% { opacity: 0.9; transform: scale(1.12) }
}
@keyframes egg-sheen { to { background-position: 200% center } }
@keyframes egg-unfold {
  from { opacity: 0; transform: translateY(-8px); filter: blur(6px) }
  to { opacity: 1; transform: translateY(0); filter: blur(0) }
}
@keyframes egg-press { 50% { transform: scale(0.985) } }
.egg-backdrop { animation: egg-backdrop 0.35s ease-out both }
.egg-card { animation: egg-rise 0.6s cubic-bezier(0.2, 0.9, 0.3, 1.2) both }
.egg-twinkle { animation: egg-twinkle 2.8s ease-in-out infinite }
.egg-beat { animation: egg-beat 1.6s ease-in-out infinite; display: inline-block }
.egg-halo { animation: egg-halo 3.6s ease-in-out infinite }
.egg-sheen {
  background-image: linear-gradient(100deg, #ffffff 0%, #9adcf2 30%, #ffffff 50%, #c9b8ff 75%, #ffffff 100%);
  background-size: 200% auto;
  -webkit-background-clip: text; background-clip: text; color: transparent;
  animation: egg-sheen 6s linear infinite;
}
.egg-rose {
  background-image: linear-gradient(100deg, #ffd6e4 0%, #ff9fc0 35%, #ffe3c2 65%, #ffd6e4 100%);
  background-size: 200% auto;
  -webkit-background-clip: text; background-clip: text; color: transparent;
  animation: egg-sheen 7s linear infinite;
}
.egg-unfold { animation: egg-unfold 0.8s ease-out both }
.egg-press { animation: egg-press 0.18s ease-out }
@media (prefers-reduced-motion: reduce) {
  .egg-backdrop, .egg-card, .egg-twinkle, .egg-beat, .egg-halo, .egg-sheen, .egg-rose, .egg-unfold, .egg-press { animation: none }
}
`;

export function BuilderEasterEgg({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [deeper, setDeeper] = useState(false);
  const [pressKey, setPressKey] = useState(0);

  const trigger = useTapRun(OPEN_TAPS, () => setOpen(true));
  const card = useTapRun(DEEPER_TAPS, () => setDeeper(true));

  const close = () => {
    setOpen(false);
    setDeeper(false);
    trigger.reset();
    card.reset();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={trigger.tap}
        aria-label="Zennith"
        data-testid="egg-trigger"
        className="cursor-default select-none rounded-full outline-none [-webkit-tap-highlight-color:transparent]"
      >
        {children}
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            data-testid="egg-overlay"
            onClick={close}
            className="egg-backdrop fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[oklch(0.1_0.05_265)]/75 backdrop-blur-md"
          >
            <style>{STYLES}</style>

            {/* Gradient rim: a 1px glowing border around the card. */}
            <div
              role="dialog"
              aria-modal="true"
              aria-label="A note from the builder"
              data-testid="egg-card"
              onClick={(e) => {
                e.stopPropagation();
                if (!deeper) {
                  card.tap();
                  setPressKey((k) => k + 1);
                }
              }}
              className="egg-card relative w-full max-w-sm select-none rounded-[1.75rem] p-px bg-gradient-to-br from-[#9adcf2]/80 via-[#5b6cff]/40 to-[#ff9fc0]/70 shadow-[0_30px_80px_-20px_rgba(60,120,255,0.55)] [-webkit-tap-highlight-color:transparent]"
            >
              <div
                key={pressKey}
                className={`relative overflow-hidden rounded-[calc(1.75rem-1px)] bg-[radial-gradient(120%_90%_at_50%_0%,oklch(0.3_0.11_255)_0%,oklch(0.17_0.07_265)_55%,oklch(0.12_0.05_270)_100%)] px-6 pt-10 pb-8 text-center text-white ${pressKey ? "egg-press" : ""}`}
              >
                {SPARKLES.map((s, i) => (
                  <span
                    key={i}
                    aria-hidden="true"
                    className="egg-twinkle pointer-events-none absolute rounded-full bg-white shadow-[0_0_8px_2px_rgba(154,220,242,0.8)]"
                    style={{
                      left: s.left,
                      top: s.top,
                      width: s.size,
                      height: s.size,
                      animationDelay: s.delay,
                    }}
                  />
                ))}

                <button
                  type="button"
                  aria-label="Close"
                  data-testid="egg-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    close();
                  }}
                  className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full text-white/60 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                >
                  <X size={16} />
                </button>

                {/* The star, in a soft breathing halo. */}
                <div className="relative mx-auto mb-5 h-20 w-20">
                  <div
                    aria-hidden="true"
                    className="egg-halo absolute inset-0 rounded-full bg-[radial-gradient(circle,rgba(154,220,242,0.55)_0%,rgba(91,108,255,0.25)_45%,transparent_70%)] blur-md"
                  />
                  <svg
                    viewBox="0 0 512 512"
                    className="relative h-20 w-20 drop-shadow-[0_0_18px_rgba(154,220,242,0.7)]"
                    aria-hidden="true"
                  >
                    <defs>
                      <linearGradient id="egg-star" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0" stopColor="#d8f3fc" />
                        <stop offset="1" stopColor="#2196c4" />
                      </linearGradient>
                    </defs>
                    <path
                      d="M256 40 C268 170 342 244 472 256 C342 268 268 342 256 472 C244 342 170 268 40 256 C170 244 244 170 256 40 Z"
                      fill="url(#egg-star)"
                    />
                    <circle cx="256" cy="256" r="26" fill="#fff" />
                  </svg>
                </div>

                <p className="text-[10px] uppercase tracking-[0.35em] text-white/50">
                  Made with care
                </p>
                <h2 className="mt-3 font-serif text-[1.65rem] leading-tight [text-wrap:balance]">
                  <span className="egg-sheen">Ndaedzo</span>{" "}
                  <span className="text-white/90">helped build this</span>{" "}
                  <span className="egg-beat" aria-hidden="true">
                    💙
                  </span>
                </h2>
                <p className="mt-3 text-sm leading-relaxed text-white/60">
                  Every queue, every record, every late night.
                </p>

                {deeper ? (
                  <div data-testid="egg-deeper" className="egg-unfold mt-7">
                    <div
                      aria-hidden="true"
                      className="mx-auto mb-6 h-px w-24 bg-gradient-to-r from-transparent via-[#ff9fc0]/80 to-transparent"
                    />
                    <p className="font-serif text-xl leading-snug">
                      <span className="egg-rose">Ndaedzo loves Ompha</span>
                    </p>
                    <p className="mt-3 font-serif text-[0.95rem] italic leading-relaxed text-white/75 [text-wrap:balance]">
                      she was my place of comfort while helping build this.
                    </p>
                    <div className="egg-beat mt-4 text-xl" aria-hidden="true">
                      💗
                    </div>
                  </div>
                ) : (
                  // A faint trail that fills as the card is tapped: enough for
                  // someone who is looking, invisible to someone who isn't.
                  <div
                    aria-hidden="true"
                    className="mt-7 flex justify-center gap-1.5"
                  >
                    {Array.from({ length: DEEPER_TAPS }, (_, i) => (
                      <span
                        key={i}
                        className={`h-1 w-1 rounded-full transition-all duration-300 ${
                          i < card.progress
                            ? "scale-150 bg-[#ff9fc0] shadow-[0_0_8px_rgba(255,159,192,0.9)]"
                            : "bg-white/10"
                        }`}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

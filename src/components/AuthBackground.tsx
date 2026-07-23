import { ZennithStar } from "./ZennithStar";
import type { ReactNode } from "react";

/** Shared animated background for all auth pages (login, signup, 2FA, forgot). */
export function AuthBackground({ children, videoSrc }: { children: ReactNode; videoSrc?: string }) {
  return (
    <div className="min-h-screen relative overflow-hidden flex items-center justify-center p-4 bg-gradient-to-br from-[oklch(0.16_0.07_265)] via-[oklch(0.22_0.1_255)] to-[oklch(0.32_0.14_240)]">
      {videoSrc && (
        <>
          <video
            src={videoSrc}
            autoPlay loop muted playsInline
            className="absolute inset-0 w-full h-full object-cover z-0"
          />
          <div className="absolute inset-0 z-0 bg-[oklch(0.16_0.07_265)]/55" />
        </>
      )}
      {/* Animated gradient blobs */}
      <div className="absolute -top-32 -left-32 w-[28rem] h-[28rem] rounded-full bg-[oklch(0.55_0.18_245)] opacity-30 blur-3xl animate-blob-1" />
      <div className="absolute -bottom-32 -right-32 w-[32rem] h-[32rem] rounded-full bg-[oklch(0.5_0.2_290)] opacity-25 blur-3xl animate-blob-2" />
      <div className="absolute top-1/3 right-1/4 w-72 h-72 rounded-full bg-[oklch(0.7_0.18_200)] opacity-20 blur-3xl animate-blob-3" />

      {/* Twinkling background stars */}
      <div className="absolute inset-0 pointer-events-none">
        {STAR_POSITIONS.map((p, i) => (
          <span
            key={i}
            className="absolute block rounded-full bg-white animate-twinkle"
            style={{
              left: `${p.x}%`,
              top: `${p.y}%`,
              width: p.s,
              height: p.s,
              animationDelay: `${p.d}s`,
              animationDuration: `${p.dur}s`,
              opacity: 0.7,
            }}
          />
        ))}
      </div>

      {/* Decorative spinning Zennith stars */}
      <div className="absolute top-8 left-8 opacity-30 animate-star-spin-slow">
        <ZennithStar size={120} animate={false} />
      </div>
      <div className="absolute bottom-8 right-8 opacity-25 animate-star-spin-slow" style={{ animationDirection: "reverse" }}>
        <ZennithStar size={170} animate={false} />
      </div>

      <div className="relative z-10 w-full flex items-center justify-center">{children}</div>
    </div>
  );
}

const STAR_POSITIONS = [
  { x: 10, y: 20, s: 2, d: 0, dur: 3 }, { x: 80, y: 15, s: 3, d: 1, dur: 4 },
  { x: 25, y: 70, s: 2, d: 2, dur: 5 }, { x: 65, y: 80, s: 2, d: 0.5, dur: 3.5 },
  { x: 45, y: 30, s: 1.5, d: 1.5, dur: 4 }, { x: 90, y: 55, s: 2, d: 2.5, dur: 6 },
  { x: 5, y: 60, s: 2.5, d: 0.8, dur: 3.2 }, { x: 55, y: 90, s: 1.5, d: 1.2, dur: 4.5 },
  { x: 35, y: 10, s: 2, d: 2, dur: 5 }, { x: 75, y: 40, s: 1.5, d: 0.3, dur: 3.8 },
  { x: 20, y: 45, s: 2, d: 1.7, dur: 4.2 }, { x: 95, y: 75, s: 2, d: 0.6, dur: 3.6 },
];

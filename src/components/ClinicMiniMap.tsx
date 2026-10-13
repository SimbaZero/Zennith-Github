import { useEffect, useState } from "react";
import { MapPin } from "lucide-react";
import { osmTileUrl, parseCoordinates, tilesForViewport } from "@/lib/geo";

// A small static map of a clinic's location, made of OpenStreetMap tile images.
//
// Why this and not a map library or a paid maps API: the app has neither, and a
// clinic card only needs "roughly where is it". The tiles are ordinary images
// from OpenStreetMap's public tile server - no account, no API key, no script.
//
// Worth knowing before this goes to real traffic:
//   * Loading a tile tells OpenStreetMap the visitor's IP address, as any image
//     host would.
//   * That server is a volunteer-run service with a usage policy that rules out
//     heavy use; a few small tiles on a signup form is the intended scale. If
//     this grows, point osmTileUrl at a commercial or self-hosted tile source.
//   * OpenStreetMap's licence requires the attribution, shown by the caller.

const ZOOM = 15; // about a neighbourhood

/** How long to wait for any tile before giving up and showing the placeholder. */
const GIVE_UP_AFTER_MS = 6000;

export function ClinicMiniMap({
  coordinates,
  name,
  width = 112,
  height = 72,
}: {
  /**
   * The clinic's stored location string. Usually coordinates ("26.1946 S,
   * 28.0473 E"), but some clinics store a street address instead; that can't be
   * mapped, so it is shown as text.
   */
  coordinates?: string | null;
  name: string;
  width?: number;
  height?: number;
}) {
  const [failed, setFailed] = useState(false);
  const [loadedAny, setLoadedAny] = useState(false);
  const point = parseCoordinates(coordinates);
  const hasPoint = point != null;
  // Restarts the give-up timer when the clinic (so the location) changes.
  const pointKey = point ? `${point.lat},${point.lng}` : "";
  const label = (coordinates ?? "").trim();
  const box = { width, height };

  // A tile request that is blocked silently (a proxy, a content blocker that
  // drops the connection rather than refusing it) never fires an error, which
  // used to leave an empty box. If nothing has arrived in a few seconds, say so.
  useEffect(() => {
    if (!hasPoint || failed || loadedAny) return;
    const t = setTimeout(() => setFailed(true), GIVE_UP_AFTER_MS);
    return () => clearTimeout(t);
  }, [hasPoint, pointKey, failed, loadedAny]);

  if (!point || failed) {
    // The fallback is never an empty space: a pin, and whatever location text
    // the clinic has (an address, or the raw coordinates).
    return (
      <div
        style={box}
        className="flex shrink-0 flex-col items-center justify-center gap-1 overflow-hidden rounded-md border bg-secondary/50 px-2 text-center text-[10px] leading-tight text-muted-foreground"
        role="img"
        aria-label={
          label ? `${name}: ${label}` : `${name}: location not listed`
        }
      >
        <MapPin size={16} aria-hidden />
        <span className="line-clamp-3 break-words">
          {label || "Location not listed"}
        </span>
      </div>
    );
  }

  const tiles = tilesForViewport(point, ZOOM, width, height);
  return (
    <div
      style={box}
      className="relative shrink-0 overflow-hidden rounded-md border bg-slate-100"
      role="img"
      aria-label={`Map showing where ${name} is`}
    >
      {tiles.map((t) => (
        <img
          key={`${t.x}/${t.y}`}
          src={osmTileUrl(t)}
          alt=""
          width={256}
          height={256}
          decoding="async"
          draggable={false}
          onLoad={() => setLoadedAny(true)}
          onError={() => setFailed(true)}
          style={{
            position: "absolute",
            left: t.left,
            top: t.top,
            maxWidth: "none",
          }}
        />
      ))}
      {/* The clinic: the viewport is centred on it. */}
      <span
        aria-hidden
        className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[oklch(0.55_0.2_25)] shadow"
      />
      <span className="absolute bottom-0 right-0 bg-white/80 px-1 text-[8px] leading-tight text-slate-600">
        © OSM
      </span>
    </div>
  );
}

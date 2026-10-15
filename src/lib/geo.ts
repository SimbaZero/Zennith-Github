// Small, dependency-free map helpers.
//
// The app has no mapping library and no map API key, and doesn't need either to
// show where a clinic is: clinics already store a coordinate, and a map is just
// a few pre-rendered image tiles placed side by side. This does the arithmetic.

export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * Reads a clinic's stored coordinate. Clinics store it as "26.1946 S, 28.0473 E";
 * a plain "-26.1946, 28.0473" is accepted too. Returns null when it isn't a
 * usable coordinate, and for anything outside the valid latitude/longitude range.
 */
export function parseCoordinates(raw?: string | null): LatLng | null {
  if (!raw) return null;
  const text = String(raw).trim();
  let lat: number | null = null;
  let lng: number | null = null;

  const hemi = text.match(
    /([\d.]+)\s*°?\s*([NS])\s*,?\s*([\d.]+)\s*°?\s*([EW])/i,
  );
  if (hemi) {
    lat = Number(hemi[1]) * (hemi[2].toUpperCase() === "S" ? -1 : 1);
    lng = Number(hemi[3]) * (hemi[4].toUpperCase() === "W" ? -1 : 1);
  } else {
    const plain = text.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    if (plain) {
      lat = Number(plain[1]);
      lng = Number(plain[2]);
    }
  }
  if (lat == null || lng == null) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 85.05 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

export const TILE_SIZE = 256;

/** Position of a point in "world pixels" at a zoom level (Web Mercator, 256px tiles). */
export function worldPixel({ lat, lng }: LatLng, zoom: number) {
  const scale = TILE_SIZE * 2 ** zoom;
  const sin = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

export interface MapTile {
  x: number;
  y: number;
  z: number;
  /** Where the tile's top-left corner sits inside the viewport, in px. */
  left: number;
  top: number;
}

/**
 * The tiles needed to fill a `width` x `height` viewport centred on `point`.
 * For a viewport no bigger than a tile this is at most four.
 */
export function tilesForViewport(
  point: LatLng,
  zoom: number,
  width: number,
  height: number,
): MapTile[] {
  const c = worldPixel(point, zoom);
  const left = c.x - width / 2;
  const top = c.y - height / 2;
  const n = 2 ** zoom;
  const tiles: MapTile[] = [];
  for (
    let ty = Math.floor(top / TILE_SIZE);
    ty <= Math.floor((top + height) / TILE_SIZE);
    ty++
  ) {
    if (ty < 0 || ty >= n) continue; // off the top or bottom of the world
    for (
      let tx = Math.floor(left / TILE_SIZE);
      tx <= Math.floor((left + width) / TILE_SIZE);
      tx++
    ) {
      tiles.push({
        x: ((tx % n) + n) % n, // wrap around the date line
        y: ty,
        z: zoom,
        left: tx * TILE_SIZE - left,
        top: ty * TILE_SIZE - top,
      });
    }
  }
  return tiles;
}

/** OpenStreetMap's public tile server: free, no key. See ClinicMiniMap for the usage note. */
export function osmTileUrl(t: Pick<MapTile, "x" | "y" | "z">): string {
  return `https://tile.openstreetmap.org/${t.z}/${t.x}/${t.y}.png`;
}

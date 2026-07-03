// Decode a geohash cell to its lat/lon bounds (for drawing heat rectangles).
const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

export function decodeGeohashBounds(gh) {
  let evenBit = true, latMin = -90, latMax = 90, lonMin = -180, lonMax = 180;
  for (const c of gh) {
    const idx = BASE32.indexOf(c);
    if (idx < 0) continue;
    for (let n = 4; n >= 0; n--) {
      const bit = (idx >> n) & 1;
      if (evenBit) { const mid = (lonMin + lonMax) / 2; if (bit) lonMin = mid; else lonMax = mid; }
      else { const mid = (latMin + latMax) / 2; if (bit) latMin = mid; else latMax = mid; }
      evenBit = !evenBit;
    }
  }
  return { south: latMin, north: latMax, west: lonMin, east: lonMax };
}

// Score (0-100) -> solar-amber color. Low = pale, high = saturated deep amber.
export function scoreColor(score) {
  const t = Math.max(0, Math.min(1, (score || 0) / 100));
  const sat = Math.round(35 + 55 * t);
  const light = Math.round(80 - 33 * t);
  return `hsl(38 ${sat}% ${light}%)`;
}

// Bulk residential fill for a ZIP (default 75218). Real-estate sites (Zillow /
// Redfin / Realtor) hard-block automated requests (403), so we enumerate REAL
// houses authoritatively: an even grid over the ZIP's geocoded bounds -> Google
// Solar findClosest (real building) -> reverse-geocode its real address -> keep
// only addresses in the target ZIP -> index as residential. Each house links out
// to Zillow/Realtor by address in the UI. Usage: node scripts/enrich-zip.mjs [count] [zip]
import { client, INDEX } from "../lib/engine.mjs";
import { fetchBuildingInsights, toParcel, reverseGeocode } from "../lib/solar.mjs";
import { embed } from "../lib/embed.mjs";

const KEY = process.env.GOOGLE_MAPS_API_KEY;
if (!KEY) { console.error("GOOGLE_MAPS_API_KEY not set (run with --env-file=.env)"); process.exit(1); }

const N = Number(process.argv[2] || 60);
const ZIP = process.argv[3] || "75218";
// 75218 geocoded bounds (Casa Linda / Casa View, NE Dallas, off Jupiter Rd).
const B = { n: 32.8710, s: 32.8043, e: -96.6679, w: -96.7289 };
const ROWS = 12, COLS = 12; // ~121 interior sample points spread across the ZIP

const pts = [];
for (let i = 1; i < ROWS; i++) for (let j = 1; j < COLS; j++)
  pts.push([B.s + (B.n - B.s) * i / ROWS, B.w + (B.e - B.w) * j / COLS]);

const seen = new Set();
let id = 0, ok = 0, skipped = 0;
for (const [lat, lon] of pts) {
  if (ok >= N) break;
  const ins = await fetchBuildingInsights(lat, lon, KEY);
  if (!ins || !ins.solarPotential) { skipped++; continue; }
  const pid = (ins.name || "").split("/").pop();
  if (seen.has(pid)) continue;
  seen.add(pid);
  const addr = await reverseGeocode(ins.center.latitude, ins.center.longitude, KEY);
  if (!addr || !addr.includes(ZIP)) { skipped++; continue; } // keep only in-ZIP
  const p = toParcel(ins, { id: `z${ZIP}-${++id}`, address: addr, city: "Dallas", zip: ZIP, sector: "residential", building_type: "residential" });
  if (!p) { skipped++; console.log(`[zip] skip mis-snap (>6000 sqft residential): ${addr}`); continue; }
  p.description_vector = await embed(p.description);
  await client.index({ index: INDEX, id: p.parcel_id, body: p });
  ok++;
  if (ok % 10 === 0) console.log(`[zip] ${ok} indexed (latest: ${addr})`);
}
await client.indices.refresh({ index: INDEX });
console.log(`[zip] done. ${ok} residential parcels in ${ZIP} indexed (${skipped} points skipped: no coverage/dupe/out-of-zip).`);
process.exit(0);

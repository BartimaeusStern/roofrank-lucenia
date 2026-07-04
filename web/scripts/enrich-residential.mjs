// Residential extrapolation: real houses on streets off Jupiter Rd (75218 + adjacent).
// For each street: geocode -> sample nearby points -> Google Solar findClosest (real
// building) -> reverse-geocode its real address -> index as a residential parcel.
// No Zillow scraping needed; the drawer links out to Zillow/Realtor by address.
import { client, INDEX } from "../lib/engine.mjs";
import { fetchBuildingInsights, toParcel, geocode, reverseGeocode } from "../lib/solar.mjs";
import { embed } from "../lib/embed.mjs";

const KEY = process.env.GOOGLE_MAPS_API_KEY;
if (!KEY) { console.error("GOOGLE_MAPS_API_KEY not set (run with --env-file=.env)"); process.exit(1); }

const STREETS = [
  { name: "Lanewood Cir, Dallas, TX 75218", city: "Dallas", zip: "75218", want: 3 },
  { name: "Rupley Ln, Dallas, TX 75218", city: "Dallas", zip: "75218", want: 2 },
  { name: "Flamingo Way, Mesquite, TX 75150", city: "Mesquite", zip: "75150", want: 2 },
];
// ~50-100m offsets to land on distinct houses along/around the street.
const OFFSETS = [[0, 0], [0.0007, 0], [-0.0007, 0], [0, 0.0009], [0, -0.0009],
  [0.0006, 0.0008], [-0.0006, -0.0008], [0.0011, 0], [-0.0011, 0], [0, 0.0014]];

const seen = new Set();
let id = 0, ok = 0;
for (const s of STREETS) {
  const base = await geocode(s.name, KEY);
  if (!base) { console.log("[res] geocode failed:", s.name); continue; }
  let got = 0;
  for (const [dlat, dlon] of OFFSETS) {
    if (got >= s.want) break;
    const ins = await fetchBuildingInsights(base.lat + dlat, base.lng + dlon, KEY);
    if (!ins || !ins.solarPotential) continue;
    const pid = (ins.name || "").split("/").pop();
    if (seen.has(pid)) continue;
    seen.add(pid);
    const addr = (await reverseGeocode(ins.center.latitude, ins.center.longitude, KEY)) || s.name;
    const p = toParcel(ins, { id: `res-${++id}`, address: addr, city: s.city, zip: s.zip, sector: "residential", building_type: "residential" });
    if (!p) { console.log(`[res] skip mis-snap (>6000 sqft residential): ${addr}`); continue; }
    p.description_vector = await embed(p.description);
    await client.index({ index: INDEX, id: p.parcel_id, body: p, refresh: true });
    console.log(`[res] ${p.parcel_id} | ${addr} | score=${p.solar_score} roof=${p.roof_type} area=${p.usable_roof_area_sqft}sqft`);
    got++; ok++;
  }
}
console.log(`[res] done. ${ok} residential parcels indexed.`);
process.exit(0);

// M2 live enrichment: call Google Solar API for a few real DFW commercial sites,
// map to parcels, embed, index (data_source=google). Proves the integration.
// Coordinates below were verified against the Solar API (all HIGH imagery quality).
import { client, INDEX } from "../lib/engine.mjs";
import { fetchBuildingInsights, toParcel } from "../lib/solar.mjs";
import { embed } from "../lib/embed.mjs";

const KEY = process.env.GOOGLE_MAPS_API_KEY;
if (!KEY) { console.error("GOOGLE_MAPS_API_KEY not set (run with: node --env-file=.env scripts/enrich-live.mjs)"); process.exit(1); }

const SITES = [
  { id: "live-1", lat: 32.7357, lon: -97.1081, address: "Great Southwest Industrial District, Arlington, TX", city: "Arlington", zip: "76011", sector: "warehouse" },
  { id: "live-2", lat: 33.0198, lon: -96.6989, address: "Commerce Park, Plano/Wylie corridor, TX", city: "Plano", zip: "75074", sector: "logistics" },
  { id: "live-3", lat: 32.8998, lon: -97.0403, address: "DFW Airport commerce area, Irving, TX", city: "Irving", zip: "75063", sector: "warehouse" },
  { id: "live-4", lat: 32.8577, lon: -96.7660, address: "Stemmons Corridor, Dallas, TX", city: "Dallas", zip: "75247", sector: "industrial" },
  { id: "live-5", lat: 32.9048, lon: -96.9200, address: "Las Colinas commercial, Irving, TX", city: "Irving", zip: "75038", sector: "office" },
  { id: "live-6", lat: 32.7767, lon: -96.7970, address: "Downtown Dallas commercial, TX", city: "Dallas", zip: "75201", sector: "office" },
];

let ok = 0;
for (const s of SITES) {
  const ins = await fetchBuildingInsights(s.lat, s.lon, KEY);
  if (!ins || !ins.solarPotential) { console.log("[live] skip (no coverage):", s.id); continue; }
  const p = toParcel(ins, s);
  p.description_vector = await embed(p.description);
  await client.index({ index: INDEX, id: p.parcel_id, body: p, refresh: true });
  console.log(`[live] indexed ${p.parcel_id} score=${p.solar_score} sun=${p.sunshine_kwh_per_kw_yr} area=${p.usable_roof_area_sqft}sqft panels=${p.max_panels}`);
  ok++;
}
console.log(`[live] done. ${ok}/${SITES.length} real Google-Solar parcels indexed.`);
process.exit(0);

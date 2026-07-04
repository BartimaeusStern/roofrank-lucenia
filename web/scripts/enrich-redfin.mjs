// Ingest REAL residential listings from Redfin (75218). Redfin/Zillow/Realtor
// block direct requests (403), but Firecrawl renders Redfin; listings were scraped
// to data/redfin-75218.json (address, price, beds, baths, sqft, working /home/ URL).
// Here we geocode each address -> Google Solar findClosest (real roof) -> index as a
// residential parcel carrying the real list_price + Redfin listing_url (a link that
// actually resolves to the house). Usage: node --env-file=.env scripts/enrich-redfin.mjs
import { client, INDEX } from "../lib/engine.mjs";
import { fetchBuildingInsights, toParcel, geocode } from "../lib/solar.mjs";
import { embed } from "../lib/embed.mjs";
import { readFileSync } from "node:fs";

const KEY = process.env.GOOGLE_MAPS_API_KEY;
if (!KEY) { console.error("GOOGLE_MAPS_API_KEY not set (run with --env-file=.env)"); process.exit(1); }

const listings = JSON.parse(readFileSync(new URL("../data/redfin-75218.json", import.meta.url)));
let ok = 0, id = 0, skipped = 0;
for (const L of listings) {
  const loc = await geocode(L.address, KEY);
  if (!loc) { skipped++; continue; }
  const ins = await fetchBuildingInsights(loc.lat, loc.lng, KEY);
  if (!ins || !ins.solarPotential) { skipped++; continue; }
  const p = toParcel(ins, {
    id: `redfin-${++id}`, address: L.address, city: "Dallas", zip: L.zip || "75218",
    sector: "residential", building_type: "residential",
    list_price: L.price, listing_url: L.url, beds: L.beds, baths: L.baths, living_sqft: L.sqft,
    year_built: L.year_built,
  });
  if (!p) { skipped++; console.log(`[redfin] skip mis-snap (>6000 sqft residential): ${L.address}`); continue; }
  p.description_vector = await embed(p.description);
  await client.index({ index: INDEX, id: p.parcel_id, body: p });
  ok++;
  if (ok % 10 === 0) console.log(`[redfin] ${ok} indexed (latest: ${L.address} $${L.price})`);
}
await client.indices.refresh({ index: INDEX });
console.log(`[redfin] done. ${ok} real Redfin residential listings indexed (${skipped} skipped).`);
process.exit(0);

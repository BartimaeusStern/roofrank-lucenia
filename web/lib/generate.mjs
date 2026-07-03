// Synthetic DFW commercial parcels drawn from realistic ranges. Seeded RNG so
// the corpus is reproducible. This is the bulk searchable corpus for the demo;
// a handful of real Google-Solar-enriched parcels are added by enrich-live.mjs.
import { computeScore, makeDescription } from "./score.mjs";

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// DFW bounding box
const LAT = [32.60, 33.05], LON = [-97.45, -96.55];
const CITIES = [
  ["Dallas", ["75201", "75207", "75212", "75247"]],
  ["Fort Worth", ["76102", "76106", "76140"]],
  ["Arlington", ["76011", "76001"]],
  ["Irving", ["75038", "75061", "75063"]],
  ["Garland", ["75040", "75041"]],
  ["Grand Prairie", ["75050", "75051"]],
  ["Mesquite", ["75149"]],
  ["Plano", ["75074", "75093"]],
  ["Carrollton", ["75006", "75007"]],
];
const STREETS = ["Industrial Blvd", "Commerce St", "Cargo Way", "Logistics Pkwy", "Distribution Dr",
  "Enterprise Blvd", "Trade Center Dr", "Manufacturing Ln", "Freight St", "Airport Fwy"];
const SECTORS = ["warehouse", "warehouse", "industrial", "logistics", "retail", "office"];

export function generateParcels(n = 400, seed = 42) {
  const r = mulberry32(seed);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const between = (a, b) => a + r() * (b - a);
  const M2 = 10.7639;
  const out = [];
  for (let i = 0; i < n; i++) {
    const sector = pick(SECTORS);
    const pitched = (sector === "retail" || sector === "office") && r() < 0.6;
    const roof_type = pitched ? "pitched" : "flat";
    const area = Math.round(pitched ? between(8000, 40000) : between(15000, 120000));
    const azimuth = Math.round(between(0, 360));
    const pitch = Math.round(pitched ? between(15, 35) : between(2, 8));
    const roof_age_years = Math.round(between(1, 35));
    const sunshine = Math.round(between(1450, 1850));
    const [city, zips] = pick(CITIES);
    const area_m2 = area * 0.092903;
    const system_kw = area_m2 * 0.11;
    const annual_kwh_dc = Math.round(system_kw * sunshine);
    const est_annual_savings_usd = Math.round(annual_kwh_dc * 0.11);
    const p = {
      parcel_id: `syn-${i}`,
      address: `${Math.round(between(100, 9999))} ${pick(STREETS)}, ${city}, TX ${pick(zips)}`,
      zip: pick(zips), city, state: "TX",
      building_type: "commercial", sector, roof_type,
      owner_occupied: r() < 0.6,
      hoa_restricted: r() < 0.12,
      best_azimuth_deg: azimuth, best_pitch_deg: pitch,
      usable_roof_area_sqft: area,
      sunshine_kwh_per_kw_yr: sunshine,
      roof_age_years,
      max_panels: Math.round((system_kw * 1000) / 400),
      annual_kwh_dc,
      est_annual_savings_usd,
      payback_years: est_annual_savings_usd ? Math.round(((system_kw * 1000 * 2.5) / est_annual_savings_usd) * 10) / 10 : null,
      imagery_quality: "SYNTHETIC", data_source: "synthetic",
      centroid: { lat: +between(LAT[0], LAT[1]).toFixed(5), lon: +between(LON[0], LON[1]).toFixed(5) },
      roof_segments: [{ azimuth_deg: azimuth, pitch_deg: pitch, area_sqft: area }],
    };
    p.solar_score = computeScore(p);
    p.description = makeDescription(p);
    out.push(p);
  }
  return out;
}

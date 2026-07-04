// Google Solar API adapter (the enrichment HELPER; Lucenia is the hero).
// buildingInsights.findClosest -> a parcel doc. Ingest-time only, for a few
// live demo addresses. Google forbids persisting these results at scale; the
// bulk corpus is synthetic, so this is demo-only (see README production path).
import { computeScore, makeDescription } from "./score.mjs";

const M2 = 10.7639;
// Residential roofs above this are a Solar findClosest mis-snap onto a large neighbor
// (warehouse/apartment on a major road), not the house. Drop them rather than show
// commercial-scale numbers on a home. Real large homes here top out near 5,400 sqft.
const MAX_RESIDENTIAL_ROOF_SQFT = 6000;

// Median of Google Solar's per-segment sunshineQuantiles (11 entries, min..max), in
// sun-hours/year. Used to shade the roof-sunlight diagram; null if unavailable.
function segmentSunshine(s) {
  const q = s.stats?.sunshineQuantiles;
  if (!Array.isArray(q) || !q.length) return null;
  return Math.round(q[Math.floor(q.length / 2)]);
}

export async function fetchBuildingInsights(lat, lon, key, quality = "LOW") {
  const url = `https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=${lat}&location.longitude=${lon}&requiredQuality=${quality}&key=${key}`;
  const r = await fetch(url);
  if (!r.ok) return null; // 404 near borders / uncovered
  return r.json();
}

export function toParcel(ins, meta) {
  const sp = ins.solarPotential || {};
  const segs = sp.roofSegmentStats || [];
  const south = segs.filter((s) => s.azimuthDegrees >= 135 && s.azimuthDegrees <= 225);
  const pick = (south.length ? south : segs)
    .slice().sort((a, b) => (b.stats?.areaMeters2 || 0) - (a.stats?.areaMeters2 || 0))[0] || {};
  const usable = (sp.wholeRoofStats?.areaMeters2
    || segs.reduce((s, x) => s + (x.stats?.areaMeters2 || 0), 0)) * M2;
  const bt = meta.building_type || "commercial";
  // Guard against mis-snap to a large neighboring building on residential ingests.
  if (bt === "residential" && usable > MAX_RESIDENTIAL_ROOF_SQFT) return null;
  const cfgs = sp.solarPanelConfigs || [];
  const bestKwh = cfgs.length ? cfgs[cfgs.length - 1].yearlyEnergyDcKwh : 0;
  const p = {
    parcel_id: meta.id,
    place_id: (ins.name || "").split("/").pop(),
    address: meta.address, zip: meta.zip, city: meta.city, state: "TX",
    building_type: bt, sector: meta.sector,
    roof_type: pick.pitchDegrees != null && pick.pitchDegrees >= 10 ? "pitched" : "flat",
    owner_occupied: true, hoa_restricted: false,
    best_azimuth_deg: pick.azimuthDegrees ?? null,
    best_pitch_deg: pick.pitchDegrees ?? null,
    usable_roof_area_sqft: Math.round(usable),
    sunshine_kwh_per_kw_yr: Math.round(sp.maxSunshineHoursPerYear || 0),
    // Roof age from listing year_built when available (Solar API has no age); else unknown.
    roof_age_years: meta.year_built ? Math.max(0, new Date().getFullYear() - Number(meta.year_built)) : null,
    year_built: meta.year_built ? Number(meta.year_built) : null,
    max_panels: sp.maxArrayPanelsCount || 0,
    annual_kwh_dc: Math.round(bestKwh),
    est_annual_savings_usd: Math.round(bestKwh * 0.11),
    payback_years: bestKwh ? Math.round(((sp.maxArrayPanelsCount * 400 * 2.5) / (bestKwh * 0.11)) * 10) / 10 : null,
    imagery_quality: ins.imageryQuality || null,
    data_source: "google",
    centroid: { lat: ins.center.latitude, lon: ins.center.longitude },
    roof_segments: segs.slice(0, 8).map((s) => ({
      azimuth_deg: s.azimuthDegrees, pitch_deg: s.pitchDegrees,
      area_sqft: Math.round((s.stats?.areaMeters2 || 0) * M2),
      sunshine: segmentSunshine(s), // sun-hours/year median, for the roof-sunlight diagram
    })),
  };
  p.solar_score = computeScore(p);
  p.description = makeDescription(p);
  // Optional listing metadata (e.g. from Redfin): price, listing URL, beds/baths/living area.
  for (const k of ["list_price", "listing_url", "beds", "baths", "living_sqft"])
    if (meta[k] != null) p[k] = meta[k];
  return p;
}

export async function geocode(address, key) {
  const r = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${key}`);
  const d = await r.json();
  return d.results?.[0]?.geometry?.location || null; // { lat, lng }
}

export async function reverseGeocode(lat, lon, key) {
  const r = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lon}&key=${key}`);
  const d = await r.json();
  const res = (d.results || []).find((x) => x.types?.includes("street_address")) || d.results?.[0];
  return res?.formatted_address || null;
}

// solar_score (energy/roof metrics only, NOT Google's residential financials)
// + the natural-language description that feeds BM25 + the embedding.

const clamp01 = (x) => Math.max(0, Math.min(1, x));

// Reference caps for region-relative normalization (tuned for DFW commercial).
export function computeScore(p) {
  const kwh = clamp01((p.annual_kwh_dc || 0) / 1_200_000);
  const sun = clamp01(((p.sunshine_kwh_per_kw_yr || 0) - 1400) / 500);
  const area = clamp01((p.usable_roof_area_sqft || 0) / 90_000);
  // Unknown age (e.g. live Google-Solar parcels) is neutral, not worst-case; older = re-roof + solar combo.
  const ageFav = p.roof_age_years == null ? 0.5 : clamp01(p.roof_age_years / 25);
  return Math.round(100 * (0.4 * kwh + 0.25 * sun + 0.2 * area + 0.15 * ageFav));
}

function ageWord(a) {
  if (a == null) return "roof age unknown";
  if (a >= 15) return "aging";
  if (a >= 8) return "mid-life";
  return "newer";
}
function orientWord(az) {
  if (az == null) return "mixed orientation";
  if (az >= 135 && az <= 225) return "south-facing";
  if (az < 45 || az > 315) return "north-facing";
  return az < 135 ? "east-facing" : "west-facing";
}

export function makeDescription(p) {
  const a = p.roof_age_years;
  const parts = [
    `${ageWord(a)} ${p.roof_type} ${p.sector} roof`,
    `~${Math.round(p.usable_roof_area_sqft).toLocaleString()} sqft`,
    orientWord(p.best_azimuth_deg),
    `~${Math.round((p.annual_kwh_dc || 0) / 1000)} MWh/yr potential`,
    p.owner_occupied ? "owner-occupied" : "leased/tenant-occupied",
  ];
  if (p.hoa_restricted) parts.push("HOA/architectural restrictions");
  const strong = p.roof_type === "flat" && p.usable_roof_area_sqft > 20000 && (a == null || a >= 15);
  parts.push(strong ? "strong re-roof plus solar candidate" : "solar retrofit candidate");
  return parts.join(", ") + ".";
}

// Unit tests for lib/score.mjs — solar_score + the NL description that feeds BM25/embeddings.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeScore, makeDescription } from "../lib/score.mjs";

const base = {
  annual_kwh_dc: 600_000, sunshine_kwh_per_kw_yr: 1650, usable_roof_area_sqft: 45_000,
  roof_age_years: 12, roof_type: "flat", sector: "warehouse", best_azimuth_deg: 180, owner_occupied: true,
};

test("computeScore pins the exact weights: all four factors at 0.5 -> 50", () => {
  // kwh 600k/1.2M=.5, sun (1650-1400)/500=.5, area 45k/90k=.5, age 12.5/25=.5
  // 100*(0.40*.5 + 0.25*.5 + 0.20*.5 + 0.15*.5) = 100*0.5 = 50
  assert.equal(computeScore({ annual_kwh_dc: 600_000, sunshine_kwh_per_kw_yr: 1650, usable_roof_area_sqft: 45_000, roof_age_years: 12.5 }), 50);
});

test("computeScore weight isolation: only energy maxed -> the 0.40 energy weight = 40", () => {
  assert.equal(computeScore({ annual_kwh_dc: 1_200_000, sunshine_kwh_per_kw_yr: 1400, usable_roof_area_sqft: 0, roof_age_years: 0 }), 40);
});

test("computeScore: unknown age contributes the neutral 0.15*0.5 = 0.075 -> 8", () => {
  assert.equal(computeScore({ annual_kwh_dc: 0, sunshine_kwh_per_kw_yr: 1400, usable_roof_area_sqft: 0, roof_age_years: null }), 8);
});

test("computeScore stays within 0..100 for extreme inputs", () => {
  const huge = computeScore({ annual_kwh_dc: 9e9, sunshine_kwh_per_kw_yr: 9999, usable_roof_area_sqft: 9e9, roof_age_years: 99 });
  const zero = computeScore({ annual_kwh_dc: 0, sunshine_kwh_per_kw_yr: 0, usable_roof_area_sqft: 0, roof_age_years: 0 });
  assert.ok(huge <= 100 && huge >= 0, `huge=${huge}`);
  assert.ok(zero <= 100 && zero >= 0, `zero=${zero}`);
  assert.equal(huge, 100);
});

test("null roof age is neutral (0.5), not worst-case", () => {
  const unknown = computeScore({ ...base, roof_age_years: null });
  const brandNew = computeScore({ ...base, roof_age_years: 0 });
  const old = computeScore({ ...base, roof_age_years: 25 });
  // age favorability: 0 (worst) < unknown (0.5) < 25 (best) — so score ordering follows.
  assert.ok(brandNew < unknown, `new ${brandNew} should be < unknown ${unknown}`);
  assert.ok(unknown < old, `unknown ${unknown} should be < old ${old}`);
});

test("more energy / area / sun raises the score", () => {
  const low = computeScore({ ...base, annual_kwh_dc: 100_000, usable_roof_area_sqft: 5_000, sunshine_kwh_per_kw_yr: 1450 });
  const high = computeScore({ ...base, annual_kwh_dc: 1_000_000, usable_roof_area_sqft: 80_000, sunshine_kwh_per_kw_yr: 1850 });
  assert.ok(high > low, `high ${high} should beat low ${low}`);
});

test("makeDescription flags unknown vs aging roofs and strong candidates", () => {
  assert.match(makeDescription({ ...base, roof_age_years: null }), /roof age unknown/);
  assert.match(makeDescription({ ...base, roof_age_years: 20 }), /aging/);
  // flat + >20k sqft + old => strong re-roof plus solar candidate
  assert.match(makeDescription({ ...base, roof_type: "flat", usable_roof_area_sqft: 40_000, roof_age_years: 18 }), /strong re-roof plus solar candidate/);
  // small newer roof => plain retrofit candidate
  assert.match(makeDescription({ ...base, roof_type: "pitched", usable_roof_area_sqft: 2_000, roof_age_years: 3 }), /solar retrofit candidate/);
});

test("makeDescription includes sector and orientation words", () => {
  const d = makeDescription({ ...base, sector: "warehouse", best_azimuth_deg: 180 });
  assert.match(d, /warehouse/);
  assert.match(d, /south-facing/);
});

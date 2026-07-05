// Unit tests for lib/solar.mjs toParcel() — the Google Solar -> parcel transform, including
// the session-2 residential mis-snap cap, per-segment sunshine capture, and year_built -> roof age.
import { test } from "node:test";
import assert from "node:assert/strict";
import { toParcel } from "../lib/solar.mjs";

const M2 = 10.7639;
// Build a minimal buildingInsights fixture. areaM2 controls usable roof sqft (= areaM2 * 10.7639).
function fakeIns({ areaM2 = 200, panels = 30, kwh = 12000, sun = 1650, quantiles } = {}) {
  return {
    name: "buildings/ChIJabc123",
    center: { latitude: 32.82, longitude: -96.7 },
    imageryQuality: "HIGH",
    solarPotential: {
      maxArrayPanelsCount: panels,
      maxSunshineHoursPerYear: sun,
      wholeRoofStats: { areaMeters2: areaM2 },
      solarPanelConfigs: [{ yearlyEnergyDcKwh: kwh / 2 }, { yearlyEnergyDcKwh: kwh }],
      roofSegmentStats: [
        { azimuthDegrees: 180, pitchDegrees: 22, stats: { areaMeters2: areaM2 * 0.6, sunshineQuantiles: quantiles ?? [1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900, 2000] } },
        { azimuthDegrees: 90, pitchDegrees: 15, stats: { areaMeters2: areaM2 * 0.4, sunshineQuantiles: quantiles ?? [800, 850, 900, 950, 1000, 1050, 1100, 1150, 1200, 1250, 1300] } },
      ],
    },
  };
}

test("residential roof over 6000 sqft is dropped as a mis-snap (returns null)", () => {
  const big = fakeIns({ areaM2: 700 }); // 700 * 10.7639 = 7535 sqft > 6000
  assert.equal(toParcel(big, { id: "z-1", address: "x", building_type: "residential", sector: "residential" }), null);
});

test("residential roof under the cap is kept", () => {
  const ok = fakeIns({ areaM2: 200 }); // ~2153 sqft
  const p = toParcel(ok, { id: "res-1", address: "123 Real St", building_type: "residential", sector: "residential" });
  assert.ok(p, "should not be null");
  assert.equal(p.building_type, "residential");
  assert.ok(p.usable_roof_area_sqft < 6000);
});

test("commercial is never capped by the residential guard", () => {
  const big = fakeIns({ areaM2: 5000 }); // ~53,800 sqft
  const p = toParcel(big, { id: "syn-1", address: "1 Industrial Blvd", building_type: "commercial", sector: "warehouse" });
  assert.ok(p, "commercial large roof must survive");
  assert.ok(p.usable_roof_area_sqft > 6000);
});

test("roof_segments capture the median of sunshineQuantiles", () => {
  const p = toParcel(fakeIns({ areaM2: 200 }), { id: "res-2", address: "y", building_type: "residential", sector: "residential" });
  // 11-entry quantiles, median index = floor(11/2) = 5 -> 1500 and 1050 for the two segments
  assert.equal(p.roof_segments[0].sunshine, 1500);
  assert.equal(p.roof_segments[1].sunshine, 1050);
});

test("year_built becomes roof_age_years; absent year_built leaves age null", () => {
  const withYear = toParcel(fakeIns({ areaM2: 200 }), { id: "r", address: "y", building_type: "residential", sector: "residential", year_built: 1990 });
  assert.equal(withYear.year_built, 1990);
  assert.equal(withYear.roof_age_years, new Date().getFullYear() - 1990);

  const noYear = toParcel(fakeIns({ areaM2: 200 }), { id: "r2", address: "y", building_type: "residential", sector: "residential" });
  assert.equal(noYear.roof_age_years, null);
});

test("listing metadata (price/beds/url) passes through when present", () => {
  const p = toParcel(fakeIns({ areaM2: 200 }), {
    id: "redfin-1", address: "y", building_type: "residential", sector: "residential",
    list_price: 500000, beds: 3, baths: 2, living_sqft: 1800, listing_url: "https://redfin.com/home/1",
  });
  assert.equal(p.list_price, 500000);
  assert.equal(p.beds, 3);
  assert.equal(p.listing_url, "https://redfin.com/home/1");
});

test("roof_type derives from pitch (>=10deg pitched, else flat)", () => {
  const pitched = toParcel(fakeIns({ areaM2: 200 }), { id: "a", address: "y", building_type: "residential", sector: "residential" });
  assert.equal(pitched.roof_type, "pitched"); // dominant south segment pitch 22
  const flatIns = fakeIns({ areaM2: 200 });
  flatIns.solarPotential.roofSegmentStats.forEach((s) => (s.pitchDegrees = 3));
  const flat = toParcel(flatIns, { id: "b", address: "y", building_type: "commercial", sector: "warehouse" });
  assert.equal(flat.roof_type, "flat");
});

// Unit tests for lib/generate.mjs — the seeded synthetic commercial corpus.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateParcels } from "../lib/generate.mjs";

test("generates the requested count, all commercial, fully populated", () => {
  const ps = generateParcels(20, 42);
  assert.equal(ps.length, 20);
  for (const p of ps) {
    assert.equal(p.building_type, "commercial");
    assert.ok(p.centroid && typeof p.centroid.lat === "number" && typeof p.centroid.lon === "number");
    assert.ok(typeof p.solar_score === "number" && p.solar_score >= 0 && p.solar_score <= 100);
    assert.ok(p.description && p.description.length > 0);
    assert.ok(Array.isArray(p.roof_segments) && p.roof_segments.length >= 1);
    assert.ok(p.usable_roof_area_sqft > 0 && p.max_panels > 0);
  }
});

test("same seed is deterministic; different seed differs", () => {
  assert.deepEqual(generateParcels(5, 42), generateParcels(5, 42));
  const a = generateParcels(5, 42)[0];
  const b = generateParcels(5, 7)[0];
  assert.notEqual(a.parcel_id + a.address, b.parcel_id + b.address, "different seed should change output");
});

test("centroids fall within the DFW bounding box", () => {
  for (const p of generateParcels(50, 1)) {
    assert.ok(p.centroid.lat >= 32.6 && p.centroid.lat <= 33.05, `lat ${p.centroid.lat}`);
    assert.ok(p.centroid.lon >= -97.45 && p.centroid.lon <= -96.55, `lon ${p.centroid.lon}`);
  }
});

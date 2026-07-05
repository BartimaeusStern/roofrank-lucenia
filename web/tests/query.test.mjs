// Unit tests for lib/query.mjs — clause building + the client-side BM25/kNN hybrid fusion
// (the one piece with real, previously-buggy logic: min-max normalize + weight + union dedup).
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeBbox, buildStructuredBody, buildKnnBody, buildHeatmapBody, mergeHybrid } from "../lib/query.mjs";

const hit = (id, score, src = {}) => ({ _id: id, _score: score, _source: { parcel_id: id, ...src } });

test("normalizeBbox orders swapped coordinates", () => {
  const b = normalizeBbox({ minLat: 33, maxLat: 32, minLon: -96, maxLon: -97 });
  assert.deepEqual(b, { minLat: 32, maxLat: 33, minLon: -97, maxLon: -96 });
});

test("buildStructuredBody sorts by solar_score desc and honors size", () => {
  const body = buildStructuredBody({ filters: { exclude_hoa: true }, size: 25 });
  assert.equal(body.size, 25);
  assert.deepEqual(body.sort, [{ solar_score: "desc" }]);
  assert.equal(body.track_total_hits, true);
});

test("building_type + range filters land in the bool filter clause", () => {
  const { query } = buildStructuredBody({ filters: { building_type: "residential", min_area_sqft: 5000 } });
  const f = JSON.stringify(query.bool.filter);
  assert.match(f, /"building_type":"residential"/);
  assert.match(f, /"usable_roof_area_sqft":\{"gte":5000\}/);
});

test("exclude_hoa defaults on (must_not), and off when explicitly false", () => {
  const on = buildStructuredBody({ filters: {} });
  assert.match(JSON.stringify(on.query.bool.must_not), /hoa_restricted/);
  const off = buildStructuredBody({ filters: { exclude_hoa: false } });
  assert.equal(off.query.bool.must_not.length, 0);
});

test("buildKnnBody carries the vector, k, and the filter", () => {
  const body = buildKnnBody({ nlVector: [0.1, 0.2, 0.3], filters: { building_type: "commercial" }, size: 60 });
  const knn = body.query.knn.description_vector;
  assert.deepEqual(knn.vector, [0.1, 0.2, 0.3]);
  assert.ok(knn.k >= 60);
  assert.match(JSON.stringify(knn.filter), /"building_type":"commercial"/);
});

test("mergeHybrid: pure BM25 weight [1,0] yields BM25 order", () => {
  const bm25 = [hit("a", 10), hit("b", 5), hit("c", 1)];
  const knn = [hit("c", 9), hit("b", 2), hit("a", 1)];
  const out = mergeHybrid(bm25, knn, [1, 0], 10);
  assert.deepEqual(out.map((h) => h._id), ["a", "b", "c"]);
});

test("mergeHybrid: pure kNN weight [0,1] yields kNN order", () => {
  const bm25 = [hit("a", 10), hit("b", 5), hit("c", 1)];
  const knn = [hit("c", 9), hit("b", 2), hit("a", 1)];
  const out = mergeHybrid(bm25, knn, [0, 1], 10);
  assert.deepEqual(out.map((h) => h._id), ["c", "b", "a"]);
});

test("mergeHybrid de-duplicates a doc present in both lists", () => {
  const bm25 = [hit("a", 10), hit("b", 5)];
  const knn = [hit("a", 8), hit("c", 4)];
  const out = mergeHybrid(bm25, knn, [0.5, 0.5], 10);
  const ids = out.map((h) => h._id);
  assert.equal(new Set(ids).size, ids.length, "no duplicate ids");
  assert.deepEqual([...ids].sort(), ["a", "b", "c"]);
});

test("mergeHybrid respects the size cap and sorts descending", () => {
  const bm25 = [hit("a", 10), hit("b", 8), hit("c", 6), hit("d", 4)];
  const knn = [hit("a", 1), hit("b", 2), hit("c", 3), hit("d", 4)];
  const out = mergeHybrid(bm25, knn, [0.4, 0.6], 2);
  assert.equal(out.length, 2);
  assert.ok(out[0]._score >= out[1]._score);
});

test("mergeHybrid handles empty inputs", () => {
  assert.deepEqual(mergeHybrid([], [], [0.4, 0.6], 10), []);
  assert.equal(mergeHybrid([hit("a", 1)], [], [0.4, 0.6], 10).length, 1);
});

test("mergeHybrid preserves _source so results carry parcel fields", () => {
  const out = mergeHybrid([hit("a", 5, { building_type: "residential" })], [], [1, 0], 10);
  assert.equal(out[0]._source.building_type, "residential");
});

test("a drawn polygon (>=3 pts) becomes a geo_polygon filter using {lat,lon} and suppresses the bbox", () => {
  const { query } = buildStructuredBody({
    filters: { polygon: [{ lat: 33, lon: -97 }, { lat: 33, lon: -96 }, { lat: 32, lon: -96 }] },
    bbox: { minLat: 32.6, maxLat: 33, minLon: -97.4, maxLon: -96.5 },
  });
  const f = JSON.stringify(query.bool.filter);
  assert.match(f, /geo_polygon/);
  assert.match(f, /"lon":-97/);        // guards the lng->lon conversion boundary
  assert.doesNotMatch(f, /geo_bounding_box/); // polygon takes precedence over the viewport
});

test("a degenerate polygon (<3 pts) is ignored and the bbox is used", () => {
  const { query } = buildStructuredBody({
    filters: { polygon: [{ lat: 33, lon: -97 }] },
    bbox: { minLat: 32.6, maxLat: 33, minLon: -97.4, maxLon: -96.5 },
  });
  const f = JSON.stringify(query.bool.filter);
  assert.doesNotMatch(f, /geo_polygon/);
  assert.match(f, /geo_bounding_box/);
});

test("buildHeatmapBody wires geohash_grid + top_hits + percentiles + corpus-wide geo_bounds", () => {
  const body = buildHeatmapBody({
    filters: { building_type: "commercial", exclude_hoa: true },
    bbox: { minLat: 32.6, maxLat: 33, minLon: -97.4, maxLon: -96.5 }, precision: 6,
  });
  const aggs = body.aggregations;
  assert.ok(aggs.heat.geohash_grid, "geohash_grid present");
  assert.ok(aggs.heat.aggregations.top.top_hits, "top_hits per cell present");
  assert.ok(aggs.score_pct.percentiles, "percentiles present");
  assert.ok("global" in aggs.allmatch, "geo_bounds runs under a global agg");
  assert.ok(aggs.allmatch.aggregations.matched.aggregations.bounds.geo_bounds, "geo_bounds present");
  // the heat query is viewport-constrained; the corpus-wide bounds filter is NOT (so "fit" can fly outside view)
  assert.match(JSON.stringify(body.query.bool.filter), /geo_bounding_box/);
  assert.doesNotMatch(JSON.stringify(aggs.allmatch.aggregations.matched.filter), /geo_bounding_box/);
  // but both still respect the building_type facet
  assert.match(JSON.stringify(aggs.allmatch.aggregations.matched.filter), /"building_type":"commercial"/);
});

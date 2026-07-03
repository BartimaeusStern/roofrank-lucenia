// Builds Lucenia query bodies + client-side hybrid fusion.
//
// IMPORTANT (Lucenia vs OpenSearch divergence): Lucenia 0.11.0 ships the `hybrid`
// query module but NOT the opensearch-neural-search normalization-processor, so an
// OpenSearch-style normalization search pipeline is a no-op on Lucenia (verified:
// flipping the pipeline weights changed nothing on the live node). We therefore run
// BM25 and kNN as two filtered queries and fuse them here with min-max normalization
// + weights, so the two signals are on a comparable scale and the weights are real
// and tunable on the actual target engine.

export function normalizeBbox(bbox) {
  if (!bbox) return undefined;
  return {
    minLat: Math.min(bbox.minLat, bbox.maxLat), maxLat: Math.max(bbox.minLat, bbox.maxLat),
    minLon: Math.min(bbox.minLon, bbox.maxLon), maxLon: Math.max(bbox.minLon, bbox.maxLon),
  };
}

function clauses(filters = {}, bbox) {
  const f = [], mustNot = [];
  if (filters.building_type) f.push({ term: { building_type: filters.building_type } });
  if (filters.roof_type) f.push({ term: { roof_type: filters.roof_type } });
  if (filters.sector) f.push({ term: { sector: filters.sector } });
  if (filters.zip) f.push({ term: { zip: filters.zip } });
  if (filters.min_area_sqft) f.push({ range: { usable_roof_area_sqft: { gte: filters.min_area_sqft } } });
  if (filters.min_sunshine) f.push({ range: { sunshine_kwh_per_kw_yr: { gte: filters.min_sunshine } } });
  if (Array.isArray(filters.azimuth_range))
    f.push({ range: { best_azimuth_deg: { gte: filters.azimuth_range[0], lte: filters.azimuth_range[1] } } });
  if (filters.owner_occupied === true) f.push({ term: { owner_occupied: true } });
  if (filters.min_roof_age) f.push({ range: { roof_age_years: { gte: filters.min_roof_age } } });
  // A drawn region (geo_polygon) takes precedence over the rectangular viewport bbox.
  // Points are { lat, lon } (callers must convert Google's { lat, lng } before sending).
  const poly = Array.isArray(filters.polygon) && filters.polygon.length >= 3 ? filters.polygon : null;
  if (poly) {
    f.push({ geo_polygon: { centroid: { points: poly.map((p) => ({ lat: p.lat, lon: p.lon })) } } });
  } else {
    const b = normalizeBbox(bbox);
    if (b) f.push({ geo_bounding_box: { centroid: {
      top_left: { lat: b.maxLat, lon: b.minLon }, bottom_right: { lat: b.minLat, lon: b.maxLon } } } });
  }
  if (filters.exclude_hoa !== false) mustNot.push({ term: { hoa_restricted: true } });
  return { f, mustNot };
}

export function buildStructuredBody({ filters, bbox, size = 50 }) {
  const { f, mustNot } = clauses(filters, bbox);
  return { size, track_total_hits: true, query: { bool: { filter: f, must_not: mustNot } }, sort: [{ solar_score: "desc" }] };
}

export function buildMatchBody({ nlText, filters, bbox, size = 100 }) {
  const { f, mustNot } = clauses(filters, bbox);
  return { size, track_total_hits: true,
    query: { bool: { must: [{ match: { description: nlText || "solar candidate roof" } }], filter: f, must_not: mustNot } } };
}

export function buildKnnBody({ nlVector, filters, bbox, size = 100 }) {
  const { f, mustNot } = clauses(filters, bbox);
  return { size, query: { knn: { description_vector: {
    vector: nlVector, k: Math.max(size, 50), filter: { bool: { filter: f, must_not: mustNot } } } } } };
}

export function buildHeatmapBody({ filters, bbox, precision = 6 }) {
  const { f, mustNot } = clauses(filters, bbox);
  // Corpus-wide filter set (same facets, but NO viewport/polygon) so "fit to results" can fly the
  // map to matching prospects outside the current view, not just tighten to what's already visible.
  const { f: fAll, mustNot: mnAll } = clauses({ ...filters, polygon: undefined }, undefined);
  return {
    size: 0,
    query: { bool: { filter: f, must_not: mustNot } },
    aggregations: {
      heat: {
        geohash_grid: { field: "centroid", precision },
        aggregations: {
          avg_score: { avg: { field: "solar_score" } },
          center: { geo_centroid: { field: "centroid" } },
          // best-scoring prospect in each cell, so clicking a heat cell can open it
          top: { top_hits: { size: 1, sort: [{ solar_score: "desc" }], _source: ["parcel_id"] } },
        },
      },
      // p90 of solar_score over the SAME viewport-constrained set the results list shows
      score_pct: { percentiles: { field: "solar_score", percents: [90] } },
      // geo_bounds over the corpus-wide matching set (ignores viewport) for "fit to results"
      allmatch: { global: {}, aggregations: {
        matched: { filter: { bool: { filter: fAll, must_not: mnAll } },
          aggregations: { bounds: { geo_bounds: { field: "centroid" } } } } } },
    },
  };
}

// Min-max normalize a hit list's _score into [0,1].
function normMap(hits) {
  const m = new Map();
  if (!hits.length) return m;
  const scores = hits.map((h) => h._score);
  const min = Math.min(...scores), max = Math.max(...scores), span = max - min || 1;
  for (const h of hits) m.set(h._id, { h, n: (h._score - min) / span });
  return m;
}

// Fuse BM25 + kNN hit lists with normalized, weighted scores. weights = [bm25, knn].
export function mergeHybrid(matchHits, knnHits, weights = [0.4, 0.6], size = 50) {
  const [wm, wk] = weights;
  const M = normMap(matchHits), K = normMap(knnHits);
  const out = [];
  for (const id of new Set([...M.keys(), ...K.keys()])) {
    const mm = M.get(id), kk = K.get(id);
    out.push({ _id: id, _score: wm * (mm?.n || 0) + wk * (kk?.n || 0), _source: (mm?.h || kk?.h)._source });
  }
  out.sort((a, b) => b._score - a._score);
  return out.slice(0, size);
}

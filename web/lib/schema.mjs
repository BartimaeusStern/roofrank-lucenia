// Index mapping + hybrid search pipeline. Mirrors the M1-validated shape.
import { client, INDEX } from "./engine.mjs";

export const MAPPING = {
  // ef_search set explicitly (default is 100): higher = better kNN recall for a small latency cost.
  settings: { index: { number_of_shards: 1, number_of_replicas: 0, knn: true, "knn.algo_param.ef_search": 256 } },
  mappings: {
    properties: {
      parcel_id: { type: "keyword" },
      place_id: { type: "keyword" },
      address: { type: "text", fields: { raw: { type: "keyword" } } },
      zip: { type: "keyword" },
      city: { type: "keyword" },
      state: { type: "keyword" },
      building_type: { type: "keyword" },
      sector: { type: "keyword" },
      roof_type: { type: "keyword" },
      owner_occupied: { type: "boolean" },
      hoa_restricted: { type: "boolean" },
      best_azimuth_deg: { type: "float" },
      best_pitch_deg: { type: "float" },
      usable_roof_area_sqft: { type: "float" },
      sunshine_kwh_per_kw_yr: { type: "float" },
      roof_age_years: { type: "integer" },
      year_built: { type: "integer" },
      max_panels: { type: "integer" },
      annual_kwh_dc: { type: "float" },
      solar_score: { type: "float" },
      est_annual_savings_usd: { type: "float" },
      payback_years: { type: "float" },
      imagery_quality: { type: "keyword" },
      data_source: { type: "keyword" },
      centroid: { type: "geo_point" },
      description: { type: "text" },
      description_vector: {
        type: "knn_vector",
        dimension: 384,
        method: { name: "hnsw", space_type: "cosinesimil", engine: "lucene" },
      },
      roof_segments: {
        type: "nested",
        properties: {
          azimuth_deg: { type: "float" },
          pitch_deg: { type: "float" },
          area_sqft: { type: "float" },
          sunshine: { type: "float" },
        },
      },
    },
  },
};

export async function recreateIndex() {
  try { await client.indices.delete({ index: INDEX }); } catch { /* not present */ }
  await client.indices.create({ index: INDEX, body: MAPPING });
}

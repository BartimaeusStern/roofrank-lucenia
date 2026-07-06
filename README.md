# RoofRank

**Commercial-solar prospecting as a search problem.** A solar sales team draws a region on a map, types a plain-language intent ("aging flat warehouse roofs that read as re-roof-plus-solar candidates"), and gets back a ranked, heat-colored map of the best rooftops to pitch, before the commercial clean-energy tax credit deadline.

Built on **Lucenia** (the retrieval engine) with **Google's Solar API** as an ingest-time enrichment helper.

**Contents:** [Why Lucenia](#why-this-and-why-lucenia) · [Architecture](#architecture) · [Verified on the live node](#verified-on-lucenia-skylite-0110-tested-against-the-live-node-not-assumed) · [Lucenia vs Google: API surface](#api-surface-which-calls-are-lucenia-vs-google) · [More Lucenia features in use](#more-lucenia-features-in-use-beyond-the-core-hybrid-query) · [How ranking works](#how-ranking-works) · [Run it](#run-it) · [Project structure](#project-structure) · [Prospecting UX](#prospecting-ux) · [Key decisions](#key-decisions)

---

## Why this, and why Lucenia

Solar customer acquisition is expensive (installers pay $100-300+ per qualified lead). The "find good roofs, then sell" workflow is really a **search-and-rank** problem over a large parcel corpus. Existing tools split into two camps:

- **Single-address design/proposal tools** (Aurora, OpenSolar, Solargraf): one address in, one proposal out. Not prospecting.
- **A few structured scan-and-rank tools** (Planno, an indie "SolarProspector", Station A): they filter and rank many roofs, but with **structured filters only**.

**Nobody combines geo + numeric + boolean + *semantic* (natural-language) in one ranked query.** That intersection is exactly what Lucenia does and a Postgres/PostGIS or a plain vector DB cannot:

| Concern | Owner |
|---|---|
| `geo_shape`/`geo_point` storage, `geo_bounding_box` filtering | **Lucenia** |
| Hybrid scoring: BM25 (lexical) + kNN (vector) + numeric/boolean filters in one query | **Lucenia** |
| `geohash_grid` heat aggregation tied to the live query | **Lucenia** |
| Ranking prospects by a composite `solar_score` | **Lucenia** |
| Roof geometry, azimuth/pitch/area, sunshine, panel layout, kWh | Google Solar API (ingest helper) |

The money shot: toggle **Structured** vs **Hybrid** on the same filters. Structured ranks the shiny new-roof warehouse first (highest score); Hybrid surfaces the *aging* roof that reads as a re-roof-plus-solar candidate, an intent a filter UI can't express. That is the "Lucenia is the ideal technical choice" proof.

**Why now:** under OBBBA (2025) the owner-purchased residential credit (§25D) expired **2025-12-31**, and the begin-construction safe harbor for the **commercial §48E/45Y credit** closed **2026-07-04**, the live federal deadline now is **placed in service by 2027-12-31**. That pushes residential demand toward **third-party-owned (lease/PPA)** systems, which still capture ~30% via §48E because the owner is a business. So the commercial and residential-via-TPO segments RoofRank ranks now share one urgent federal deadline, which is exactly the moment a prospecting tool earns its keep.

---

## Architecture

```
Parcel source ──► Google Solar API ──► transform+score+embed ──► Lucenia (Docker)
(synthetic bulk    (buildingInsights,    (MiniLM 384-dim,          parcels index:
 + a few real       ingest-time only)     solar_score)             geo_shape + knn_vector
 DFW addresses)                                                    + numeric/keyword/text)
                                                                          ▲
                            Next.js UI ──► route handlers (opensearch-js) ─┘
                            (Google Map + heat cells + filters + NL search + ranked list + quote)
```

- **Engine:** Lucenia `skylite 0.11.0` (OpenSearch 2.14 wire-compatible). Hybrid ranking fuses BM25 + filtered kNN **client-side** (min-max normalize each score list, then weighted combine). Lucenia's native `hybrid` query works on this node, but it returns a single combined score per doc and there is no functional score-normalization step to weight the sub-queries (see the verified note below), so **client-side fusion is the only way to get real, tunable `[BM25, kNN]` weights** on this build, not just a workaround. Verified: flipping the client weights reorders results on the live node.
- **Embeddings:** local MiniLM (`@huggingface/transformers`, `all-MiniLM-L6-v2`, 384-dim). Private, no external embedding calls.
- **App:** one Next.js 16 app. Route handlers are the API (client never talks to Lucenia directly). Tailwind v4 design tokens (solar/amber), `@vis.gl/react-google-maps` for the map.

### Verified on Lucenia skylite 0.11.0 (tested against the live node, not assumed)

Lucenia tracks the OpenSearch 2.14 API, but its docs describe a superset of what this build ships. Rather than trust the docs, each of these was tested directly against the running node:

- **`hybrid` query clause, present and works.** `{"query":{"hybrid":{"queries":[{match…},{knn…}]}}}` returns results. But without a working normalization step it emits a single un-normalized combined score and ignores per-query weights (below), so it can't drive tunable fusion on its own.
- **`normalization-processor`, accepted but inert on this build.** `PUT /_search/pipeline` with a `normalization-processor` returns `acknowledged:true`, yet: (a) flipping its weights `[0.95,0.05]`↔`[0.05,0.95]` does not reorder results, (b) with-pipeline scores are byte-identical to no-pipeline and are raw (≈4.6, not a normalized 0–1), and (c) `_nodes/search_pipelines` registers **no `phase_results_processors`** at all. So real BM25/kNN weighting is done **client-side** (`lib/query.mjs` `mergeHybrid`: min-max normalize each list, then weighted combine), the only path to tunable weights here.
- **`geohex_grid`, not supported** (`parsing_exception`). The heatmap uses **`geohash_grid`** (verified working) with `avg(solar_score)` + `geo_centroid` sub-aggregations.

These are version facts about `skylite 0.11.0`, not permanent Lucenia limits, a build that ships a functional `normalization-processor` could move fusion server-side unchanged, since the app already speaks the `hybrid` query shape.

### Data (and an honest note on Google's terms)

The searchable corpus is **~400 synthetic DFW commercial parcels** (reproducible, seeded) plus **6 real commercial parcels enriched live via the Google Solar API** (labeled `LIVE · Google Solar`) and **~100 real residential parcels in ZIP 75218** (exact-address-geocoded houses + real Redfin for-sale listings with list price, beds/baths, and living area). This split is deliberate: Google's Solar API policy **restricts caching/storing** its results, so a production build cannot pre-index Google's per-building data at scale. The production-clean path (described, not built here) is to **compute solar potential from open rasters** (USGS LiDAR DSM + NREL NSRDB + PVWatts) and index *your* derived values in Lucenia, with Google Solar used only live at view-time. "Compute and index, don't cache a vendor's API."

**Residential data quality:** houses are located by exact-address geocoding, not arbitrary grid points, because `buildingInsights.findClosest` will otherwise mis-snap to a large neighbor (a warehouse or apartment block on a major road) and report commercial-scale roof numbers on a home. As a backstop, any residential parcel resolving to a >6,000 sqft roof is dropped as a mis-snap at ingest.

---

## API surface: which calls are Lucenia vs Google

The division is deliberate: **Google answers "what is this roof, physically?" once, at ingest. Lucenia answers "which roofs match this intent, ranked, in this area?" on every search.**

**Lucenia, the retrieval / ranking / geo engine (every query at search time):**

- **Index mapping** (`lib/schema.mjs`): `geo_point` (centroid), `knn_vector` (384-dim, HNSW, `engine: lucene`, `space_type: cosinesimil`), analyzed `text` (`description` → BM25), `keyword`/`float`/`integer`/`boolean` facets, and a `nested` `roof_segments`. `index.knn: true`.
- **Lexical:** `match` on `description` (BM25).
- **Vector:** `knn` query on `description_vector` with `k` + an inline `filter` (Lucene-engine filtered kNN).
- **Structured:** `bool` (`filter` + `must_not`), `term`/`range` facets, `sort` by `solar_score`.
- **Geo:** `geo_bounding_box` on centroid (map viewport → query).
- **Aggregation:** `geohash_grid` on centroid with `avg(solar_score)` + `geo_centroid` sub-aggregations (the heat layer).
- **Fusion:** client-side min-max normalize + weighted combine of the `match` and `knn` result lists (`lib/query.mjs` `mergeHybrid`).
- **Client:** `@opensearch-project/opensearch` (wire-compatible), raw `_search` via `transport.request`.

**Google, ingest-time enrichment only (never at search time):**

- **Solar API `buildingInsights:findClosest`** → roof physics per building: `wholeRoofStats.areaMeters2`, `roofSegmentStats` (azimuth / pitch / area / `sunshineQuantiles`), `maxArrayPanelsCount`, `maxSunshineHoursPerYear`, `solarPanelConfigs[].yearlyEnergyDcKwh`, `imageryQuality`, `center`. Mapped → scored → embedded → indexed into Lucenia (`lib/solar.mjs`).
- **Maps Geocoding API** (not Solar): `geocode` (address → lat/lng) and `reverseGeocode` (lat/lng → address) to place real houses precisely.
- **Maps JavaScript API:** the browser map + dark-mode `colorScheme` (`@vis.gl/react-google-maps`).
- **Not used:** Solar `dataLayers` (flux/DSM rasters) and Google's financial analyses. `solar_score` is computed locally from energy/roof metrics, not Google's residential financial model.

## More Lucenia features in use (beyond the core hybrid query)

Each of these is **built and live**, and was verified against the running node:

- **`geo_bounds` aggregation → the "Fit to results" button.** Computed corpus-wide via a `global` + `filter` agg that ignores the viewport, so it flies the map to matching prospects *outside* the current view rather than just tightening to what's visible (zoom-clamped for single-result bounds).
- **`percentiles` on `solar_score` → the "Top 10% of roofs in view score ≥ N" stat** in the results header (p90 over the same in-view set the list shows).
- **`top_hits` inside each `geohash_grid` cell → clickable heat cells.** Each cell carries its best-scoring parcel (a `top_hits` sub-agg sorted by `solar_score`); clicking the cell opens that parcel.
- **`geo_polygon` query → "Draw region".** Click vertices on the map to filter by an arbitrary polygon instead of the rectangular viewport (verified: a polygon over 75218 returns 108 parcels, all inside, vs ~468 for the bounding box). Note: Google removed `DrawingManager` in Maps JS 3.65, so the polygon is collected via map-click vertices on a plain `google.maps.Polygon`.
- **`knn.algo_param.ef_search = 256`** (raised from the default 100) for kNN recall headroom.

**Registered on the node but intentionally not wired (needs an ML model/connector):** `retrieval_augmented_generation` / `retrieval_grounding` (native in-engine RAG), `multimodal_rerank`, `ml_inference`. Probed, not assumed: a `retrieval_augmented_generation` pipeline errors requiring `context_field_list` + a registered model. These are the on-thesis path to in-engine "why this roof" summaries or learned reranking, and are precisely why a *separate* RAG stack (e.g. LightRAG, which was evaluated and rejected) is unnecessary here: Lucenia already owns that surface.

---

## How ranking works

**`solar_score` (0–100)** is computed at ingest (`lib/score.mjs`) from four normalized, region-capped factors:

| Factor | Weight | Normalization (DFW-tuned caps) |
|---|---|---|
| Annual energy `annual_kwh_dc` | **0.40** | ÷ 1,200,000 kWh, clamped 0–1 |
| Sunshine `sunshine_kwh_per_kw_yr` | **0.25** | (value − 1400) ÷ 500, clamped 0–1 |
| Usable roof area (sqft) | **0.20** | ÷ 90,000 sqft, clamped 0–1 |
| Roof-age favorability | **0.15** | age ÷ 25 yrs, clamped 0–1; **unknown age = 0.5** (neutral) |

`score = round(100 · (0.40·energy + 0.25·sun + 0.20·area + 0.15·ageFav))`

Energy is weighted highest because it drives ROI. Roof age is deliberately a *favorability* term, not a penalty: an older roof is a re-roof-plus-solar opportunity, so it scores **higher**, while unknown age stays neutral so live Google-Solar parcels (which have no age) aren't punished. The caps are region-relative to DFW commercial and would be recalibrated per market. The exact weights are pinned by a unit test (`tests/score.test.mjs`).

**Sorting** has three tiers, and the list and map markers always reflect the same set:

1. **Best match** (default), the engine's own relevance order: fused hybrid BM25 + kNN for the natural-language query in Hybrid mode, or `solar_score` descending in Structured mode. No client reordering.
2. **Solar / ZIP / Address**, click a field to sort client-side; click the same field again to flip asc↔desc (an arrow shows the direction).
3. **Clear**, returns to Best match.

---

## Run it

**Prereqable:** Docker, Node 20+, and either a Lucenia trial license **or** an OpenSearch 2.14 node (see below).

```bash
# 1) Start the engine
#    Lucenia needs a trial license cert (get one at https://cloud.lucenia.io/trial),
#    saved as ./trial.crt at the repo root, then:
docker compose up -d          # Lucenia on https://localhost:9200

# 2) App + data
cd web
npm install
cp .env.example .env          # fill in GOOGLE_MAPS_API_KEY (+ NEXT_PUBLIC_ copy)
npm run seed                  # create index, generate 400 commercial parcels, MiniLM-embed, bulk index
npm run enrich                # (optional) add 6 real Google-Solar commercial parcels
npm run res                   # (optional) ~7 exact-address residential houses (75218 + adjacent)
npm run redfin                # (optional) ~40 real Redfin 75218 for-sale listings (price/beds/baths)
npm run zip                   # (optional) grid-fill more 75218 houses (mis-snaps auto-dropped)
npm run dev                   # http://localhost:3000
```

**License-free alternative (Lucenia is OpenSearch-wire-compatible):** if you'd rather not obtain a Lucenia license, run any OpenSearch 2.14 node instead and point the app at it, everything works unchanged (validated):

```bash
docker run -d -p 9200:9200 -e discovery.type=single-node \
  -e OPENSEARCH_INITIAL_ADMIN_PASSWORD=RoofRank!2026Dev opensearchproject/opensearch:2.14.0
# then the same npm run seed / dev
```

**Notes:** the browser map needs the **Maps JavaScript API** enabled on the key (the Solar API alone is server-side); if it isn't, the app degrades gracefully (the ranked list + search still work). The local Lucenia node uses a self-signed cert, so the server-side client sets `rejectUnauthorized:false` for `localhost` only; production terminates TLS with a real CA.

---

## Project structure

```
docker-compose.yml        Lucenia node (port 9200, mounts trial.crt + license env)
trial.crt                 Lucenia license (gitignored)
spike.py                  M1 query-validation spike (engine-agnostic, all checks pass)
web/
  lib/  engine, schema, embed, score, generate, solar, query   (.mjs, shared by scripts + API)
  scripts/  seed, enrich-live, enrich-residential, enrich-redfin, enrich-zip, scrape-year-built, e2e
  app/  page.tsx, layout.tsx, globals.css, api/{search,parcel/[id],heatmap}/route.ts
  components/  RoofRank, FilterPanel, ResultsList, ParcelDrawer, MapView
```

## Prospecting UX

- **Building-type toggle** (Both / Residential / Commercial) on the ranked-prospects panel: one click re-runs the search against that segment.
- **Sort** by Solar score / ZIP / Address: click a field to sort, click again to flip direction, clear to return to **Best match** (the hybrid relevance order the engine returns).
- **Parcel drawer** shows a draft quote (residential uses ~$3.50/W + the §25D credit; commercial ~$2.80/W + §48E), a **roof-sunlight diagram** (each Google-Solar roof segment shaded in a purple gradient by annual sun), and, for real listings, price/beds/baths, price-per-sqft, a resolving listing link, and roof age from year built.
- **Collapsible filter panel** to hand the map more room.
- **Dark mode** via a pure design-token swap (`.dark` on `<html>` overrides the CSS vars): panels, drawer, inputs, cards, and the Google map (`colorScheme`) all flip together. Toggle sits left of the collapse button (and on the collapsed rail); the choice persists in `localStorage` and paints before hydration (no flash).

## Key decisions

- **Lucenia is the hero, Google is the helper.** The search/rank experience is the product; Google Solar only enriches at ingest.
- **Semantic query is the differentiator** (the one axis no competitor has).
- **Hybrid data** sidesteps Google's caching restriction and keeps the demo fully populated.
- **`solar_score`** uses energy/roof metrics (kWh, area, sunshine, roof-age favorability), not Google's residential-tuned financial model.
- Built lean (ponytail): one app, one search client, local embeddings over a hosted pipeline, Tailwind tokens over a component-library dependency, HTML quote over a PDF lib.

## Not in this MVP (deliberately)

Real outreach / AI-SDR, a generative "panels on your building" render pipeline, user accounts / saved searches / lead tracking (a future Supabase layer), multi-region on-demand scan.

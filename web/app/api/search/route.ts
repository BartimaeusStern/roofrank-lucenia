import { NextResponse } from "next/server";
import { buildStructuredBody, buildMatchBody, buildKnnBody, mergeHybrid } from "@/lib/query.mjs";
import { search } from "@/lib/engine.mjs";
import { embed } from "@/lib/embed.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const strip = (src: any) => { const { description_vector, ...rest } = src; return rest; };

// POST { nl, filters, bbox, mode: "hybrid"|"structured", size }
// hybrid runs BM25 + filtered kNN as two queries and fuses them client-side
// with normalized, weighted scores (Lucenia has no normalization-processor;
// see lib/query.mjs). filters.weights = [bm25, knn] is an optional override.
export async function POST(req: Request) {
  try {
    const { nl = "", filters = {}, bbox, mode = "hybrid", size = 50 } = await req.json();
    const t0 = Date.now();

    if (mode === "structured" || !nl) {
      const res = await search(buildStructuredBody({ filters, bbox, size }));
      const results = (res.hits?.hits || []).map((h: any) => ({ id: h._id, score: h._score, ...strip(h._source) }));
      return NextResponse.json({ mode: "structured", total: res.hits?.total?.value ?? results.length, took_ms: Date.now() - t0, results });
    }

    const nlVector = await embed(nl);
    const [mr, kr] = await Promise.all([
      search(buildMatchBody({ nlText: nl, filters, bbox, size: Math.max(size, 50) })),
      search(buildKnnBody({ nlVector, filters, bbox, size: Math.max(size, 50) })),
    ]);
    const merged = mergeHybrid(mr.hits?.hits || [], kr.hits?.hits || [], filters.weights || [0.4, 0.6], size);
    const results = merged.map((h: any) => ({ id: h._id, score: h._score, ...strip(h._source) }));
    return NextResponse.json({ mode: "hybrid", total: mr.hits?.total?.value ?? results.length, took_ms: Date.now() - t0, results });
  } catch (e: any) {
    console.error("search error", e);
    return NextResponse.json({ error: "search failed", detail: String(e?.message || e), results: [] }, { status: 400 });
  }
}

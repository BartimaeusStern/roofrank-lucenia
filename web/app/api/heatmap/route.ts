import { NextResponse } from "next/server";
import { buildHeatmapBody } from "@/lib/query.mjs";
import { search } from "@/lib/engine.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { filters, bbox, precision } -> geohash grid of scored-prospect density.
export async function POST(req: Request) {
  try {
    const { filters = {}, bbox, precision = 6 } = await req.json();
    const res = await search(buildHeatmapBody({ filters, bbox, precision }));
    const agg = res.aggregations || {};
    const cells = (agg.heat?.buckets || []).map((b: any) => ({
      key: b.key,
      count: b.doc_count,
      avg_score: b.avg_score?.value,
      center: b.center?.location,
      top_id: b.top?.hits?.hits?.[0]?._id ?? null, // best prospect in the cell (for click-to-open)
    }));
    const p90 = agg.score_pct?.values?.["90.0"] ?? null;              // top-decile solar score in view
    const bounds = agg.allmatch?.matched?.bounds?.bounds ?? null;      // corpus-wide fit-to-results box
    return NextResponse.json({ cells, p90, bounds });
  } catch (e: any) {
    console.error("heatmap error", e);
    return NextResponse.json({ cells: [], error: String(e?.message || e) }, { status: 400 });
  }
}

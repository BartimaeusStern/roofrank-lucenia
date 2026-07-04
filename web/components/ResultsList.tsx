"use client";
import { scoreColor } from "@/lib/geohash.mjs";

type Parcel = {
  id: string; address: string; sector: string; roof_type: string;
  solar_score: number; usable_roof_area_sqft: number; annual_kwh_dc: number;
  roof_age_years: number | null; data_source: string;
};

export default function ResultsList({ results, onSelect, selectedId, loading, sort, onSortClick, buildingType, onBuildingType, p90 }: {
  results: Parcel[]; onSelect: (id: string) => void; selectedId?: string; loading: boolean;
  sort: { field: string; dir: "asc" | "desc" }; onSortClick: (field: string) => void;
  buildingType: string; onBuildingType: (bt: string) => void; p90?: number | null;
}) {
  return (
    <div className="p-3">
      <div className="flex items-center justify-between gap-2 px-1 pb-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
          Ranked prospects{results.length ? ` (${results.length})` : ""}
        </h2>
        {/* Building-type toggle: one click filters the corpus (server-side). "" = Both. */}
        <div className="flex rounded-md bg-background p-0.5 text-xs">
          {([["", "Both"], ["residential", "Res"], ["commercial", "Com"]] as const).map(([v, l]) => (
            <button key={v} data-testid={`bt-${v || "both"}`} onClick={() => onBuildingType(v)}
              className={`rounded px-2 py-1 font-medium transition ${buildingType === v ? "bg-accent text-white shadow-sm" : "text-muted hover:text-foreground"}`}>
              {l}
            </button>
          ))}
        </div>
      </div>
      {/* Distribution stat from Lucenia's percentiles aggregation over the in-view set. */}
      {p90 != null && results.length > 0 && (
        <p className="px-1 pb-1 text-[11px] text-muted">Top 10% of roofs in view score <span className="font-semibold text-accent-strong">≥ {Math.round(p90)}</span></p>
      )}
      {/* Sort: click a field to sort; click again to flip; clear returns to Best match (engine relevance). */}
      <div className="mb-2 flex items-center gap-1 px-1 text-xs">
        <span className="text-muted">Sort:</span>
        {([["solar", "Solar"], ["zip", "ZIP"], ["address", "Address"]] as const).map(([field, label]) => {
          const active = sort.field === field;
          return (
            <button key={field} data-testid={`sort-${field}`} onClick={() => onSortClick(field)}
              className={`rounded px-1.5 py-0.5 font-medium transition ${active ? "bg-accent/15 text-accent-strong" : "text-muted hover:text-foreground"}`}>
              {label}{active ? (sort.dir === "asc" ? " ↑" : " ↓") : ""}
            </button>
          );
        })}
        {sort.field !== "relevance" ? (
          <button data-testid="sort-clear" onClick={() => onSortClick("relevance")}
            className="ml-auto rounded px-1.5 py-0.5 text-muted hover:text-foreground">clear</button>
        ) : (
          <span className="ml-auto text-muted">Best match</span>
        )}
      </div>
      {loading && !results.length && <p className="px-1 text-sm text-muted">Searching…</p>}
      {!loading && !results.length && <p className="px-1 text-sm text-muted">No matches. Loosen the filters.</p>}
      <ul className="space-y-2">
        {results.map((r, i) => (
          <li key={r.id}>
            <button data-testid="result" data-id={r.id} data-score={r.solar_score} onClick={() => onSelect(r.id)}
              className={`w-full rounded-[var(--radius)] border bg-surface p-3 text-left transition ${selectedId === r.id ? "border-accent ring-1 ring-accent" : "border-border hover:border-accent/60"}`}>
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-medium leading-tight">{i + 1}. {r.address}</span>
                <ScoreBadge score={r.solar_score} />
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
                <span className="capitalize">{r.sector} · {r.roof_type}</span>
                <span>{Math.round(r.usable_roof_area_sqft).toLocaleString()} sqft</span>
                <span>{Math.round(r.annual_kwh_dc / 1000).toLocaleString()} MWh/yr</span>
                {r.roof_age_years != null && <span>{r.roof_age_years}-yr roof</span>}
                {r.data_source === "google" && (
                  <span className="rounded bg-accent/15 px-1 font-semibold text-accent-strong">LIVE · Google Solar</span>
                )}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  return (
    <span className="shrink-0 rounded-md px-2 py-0.5 text-xs font-bold text-white"
      style={{ background: scoreColor(score) }} title="solar score">
      {Math.round(score)}
    </span>
  );
}

"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FilterPanel from "./FilterPanel";
import ResultsList from "./ResultsList";
import ParcelDrawer from "./ParcelDrawer";
import MapView from "./MapView";

const DEFAULT_BBOX = { minLat: 32.6, maxLat: 33.05, minLon: -97.45, maxLon: -96.55 };
const DEFAULT_FILTERS = {
  building_type: "", roof_type: "", min_area_sqft: 0, min_sunshine: 0,
  min_roof_age: 0, southFacing: false, owner_occupied: false, exclude_hoa: true,
};

export default function RoofRank() {
  const [nl, setNl] = useState("aging flat warehouse roofs, re-roof plus solar candidates, unshaded");
  const [mode, setMode] = useState("hybrid");
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [results, setResults] = useState<any[]>([]);
  const [heat, setHeat] = useState<any[]>([]);
  const [bounds, setBounds] = useState<any>(null);            // geo_bounds for "fit to results"
  const [p90, setP90] = useState<number | null>(null);        // top-decile solar score in view
  const [polygon, setPolygon] = useState<{ lat: number; lon: number }[] | null>(null); // drawn region
  const [selected, setSelected] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [tookMs, setTookMs] = useState<number | null>(null);
  const [total, setTotal] = useState(0);
  // Sort is a {field, dir} pair. field="relevance" = engine "Best match" order (no client sort).
  const [sort, setSort] = useState<{ field: string; dir: "asc" | "desc" }>({ field: "relevance", dir: "desc" });
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  // Theme: the pre-hydration script in layout already set the .dark class from localStorage/OS;
  // we read it back on mount so the toggle icon matches, then flip the class + persist on toggle.
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => { setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light"); }, []);
  const toggleTheme = () => setTheme((prev) => {
    const next = prev === "dark" ? "light" : "dark";
    document.documentElement.classList.toggle("dark", next === "dark");
    try { localStorage.setItem("roofrank-theme", next); } catch { /* private mode */ }
    return next;
  });
  const bboxRef = useRef(DEFAULT_BBOX);
  const reqIdRef = useRef(0);

  const toApiFilters = (f: typeof DEFAULT_FILTERS) => ({
    building_type: f.building_type || undefined,
    roof_type: f.roof_type || undefined,
    min_area_sqft: f.min_area_sqft || undefined,
    min_sunshine: f.min_sunshine || undefined,
    azimuth_range: f.southFacing ? [135, 225] : undefined,
    min_roof_age: f.min_roof_age || undefined,
    owner_occupied: f.owner_occupied || undefined,
    exclude_hoa: f.exclude_hoa,
  });

  const run = useCallback(async (override?: { mode?: string; filters?: typeof DEFAULT_FILTERS; polygon?: { lat: number; lon: number }[] | null }) => {
    const myId = ++reqIdRef.current;
    setLoading(true);
    const m = override?.mode || mode;
    // Use override values when provided so a toggle/draw can search immediately (state updates are async).
    const poly = override && "polygon" in override ? override.polygon : polygon;
    const apiFilters = { ...toApiFilters(override?.filters || filters), polygon: poly && poly.length >= 3 ? poly : undefined };
    const bbox = bboxRef.current;
    try {
      const [sr, hr] = await Promise.all([
        // size covers the whole corpus (~500) so the map shows every matching prospect as a dot,
        // not just the top-100 by relevance; otherwise residential (lower-scored than commercial)
        // never appears in "Both" mode and only the heatmap shades their area.
        fetch("/api/search", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nl, mode: m, filters: apiFilters, bbox, size: 600 }) }).then((r) => r.json()),
        fetch("/api/heatmap", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filters: apiFilters, bbox, precision: 6 }) }).then((r) => r.json()),
      ]);
      if (myId !== reqIdRef.current) return; // a newer search superseded this one
      setResults(sr.results || []); setTookMs(sr.took_ms ?? null); setTotal(sr.total || 0);
      setHeat(hr.cells || []); setBounds(hr.bounds || null); setP90(hr.p90 ?? null);
    } catch (e) {
      console.error("search failed", e);
    } finally {
      if (myId === reqIdRef.current) setLoading(false);
    }
  }, [nl, mode, filters, polygon]);

  useEffect(() => { run(); /* initial load */ }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const switchMode = (m: string) => { setMode(m); run({ mode: m }); };

  // Building-type toggle (Both / Commercial / Residential). Server-side filter, so re-run search.
  const setBuildingType = (bt: string) => {
    const next = { ...filters, building_type: bt };
    setFilters(next);
    run({ filters: next });
  };

  // Draw-a-region: a drawn polygon (geo_polygon) replaces the viewport bbox until cleared.
  const applyPolygon = (pts: { lat: number; lon: number }[]) => { setPolygon(pts); run({ polygon: pts }); };
  const clearPolygon = () => { setPolygon(null); run({ polygon: null }); };

  // Click a sort field: same field flips direction; a new field uses its natural default;
  // clicking "relevance" clears back to Best match (engine order).
  const onSortClick = (field: string) => {
    setSort((prev) => {
      if (field === "relevance") return { field: "relevance", dir: "desc" };
      if (prev.field === field) return { field, dir: prev.dir === "asc" ? "desc" : "asc" };
      return { field, dir: field === "solar" ? "desc" : "asc" }; // solar high-first; text A-Z
    });
  };

  const openParcel = useCallback(async (id: string) => {
    try {
      const p = await fetch(`/api/parcel/${id}`).then((r) => r.json());
      setSelected(p);
    } catch (e) { console.error("parcel fetch failed", e); }
  }, []);

  const sorted = useMemo(() => {
    if (sort.field === "relevance") return results; // engine "Best match" order
    const key: Record<string, (r: any) => any> = {
      solar: (r) => r.solar_score || 0,
      zip: (r) => String(r.zip || ""),
      address: (r) => String(r.address || ""),
    };
    const get = key[sort.field];
    if (!get) return results;
    const mul = sort.dir === "asc" ? 1 : -1;
    return [...results].sort((a, b) => {
      const av = get(a), bv = get(b);
      const c = typeof av === "number" ? av - bv : String(av).localeCompare(String(bv));
      return mul * c || String(a.address || "").localeCompare(String(b.address || "")); // stable tiebreak
    });
  }, [results, sort]);

  return (
    <div className="flex h-screen overflow-hidden">
      {panelCollapsed ? (
        <div className="flex w-8 shrink-0 flex-col items-center gap-3 border-r border-border bg-panel py-3">
          <button data-testid="panel-expand" onClick={() => setPanelCollapsed(false)} title="Show filters"
            className="flex flex-col items-center gap-3 text-muted hover:text-foreground">
            <span aria-hidden className="text-lg leading-none">»</span>
            <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ writingMode: "vertical-rl" }}>Filters</span>
          </button>
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>
      ) : (
        <aside className="relative w-[340px] shrink-0 overflow-y-auto border-r border-border bg-panel">
          <div className="absolute right-2 top-2 z-10 flex items-center gap-1">
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
            <button data-testid="panel-collapse" onClick={() => setPanelCollapsed(true)}
              title="Collapse filters"
              className="rounded px-2 py-1 text-muted hover:bg-background hover:text-foreground">«</button>
          </div>
          <FilterPanel nl={nl} setNl={setNl} mode={mode} setMode={switchMode}
            filters={filters} setFilters={setFilters} onSearch={() => run()}
            loading={loading} total={total} tookMs={tookMs} />
        </aside>
      )}
      <main className="relative flex-1">
        <MapView results={results} heat={heat} onBounds={(b) => { bboxRef.current = b; }}
          onSelect={openParcel} selectedId={selected?.id} theme={theme}
          bounds={bounds} onPolygon={applyPolygon} onClearPolygon={clearPolygon} hasPolygon={!!polygon} />
        {selected && <ParcelDrawer parcel={selected} onClose={() => setSelected(null)} />}
      </main>
      <aside className="w-[380px] shrink-0 overflow-y-auto border-l border-border bg-panel">
        <ResultsList results={sorted} onSelect={openParcel} selectedId={selected?.id} loading={loading}
          sort={sort} onSortClick={onSortClick}
          buildingType={filters.building_type} onBuildingType={setBuildingType} p90={p90} />
      </aside>
    </div>
  );
}

function ThemeToggle({ theme, onToggle }: { theme: string; onToggle: () => void }) {
  const dark = theme === "dark";
  return (
    <button data-testid="theme-toggle" onClick={onToggle} aria-label="Toggle dark mode"
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      className="rounded px-2 py-1 text-muted transition hover:bg-background hover:text-foreground">
      {dark ? (
        // sun
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
        </svg>
      ) : (
        // moon
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      )}
    </button>
  );
}

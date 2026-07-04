"use client";

type Filters = {
  building_type: string; roof_type: string; min_area_sqft: number; min_sunshine: number;
  min_roof_age: number; southFacing: boolean; owner_occupied: boolean; exclude_hoa: boolean;
};
type Props = {
  nl: string; setNl: (v: string) => void;
  mode: string; setMode: (m: string) => void;
  filters: Filters; setFilters: (f: Filters) => void;
  onSearch: () => void; loading: boolean; total: number; tookMs: number | null;
};

export default function FilterPanel(p: Props) {
  const up = (k: keyof Filters, v: unknown) => p.setFilters({ ...p.filters, [k]: v });
  const f = p.filters;
  return (
    <div className="space-y-5 p-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Roof<span className="text-accent">Rank</span></h1>
        <p className="mt-0.5 text-xs text-muted">
          Commercial solar prospecting on Lucenia. Rank DFW rooftops for the federal §48E clean-energy credit (systems placed in service by 2027-12-31).
        </p>
      </div>

      <div>
        <label className="text-xs font-medium text-muted">Natural-language intent</label>
        <textarea
          value={p.nl} onChange={(e) => p.setNl(e.target.value)} rows={2}
          className="mt-1 w-full rounded-[var(--radius)] border border-border bg-surface p-2 text-sm outline-none focus:border-accent"
        />
      </div>

      <div>
        <label className="text-xs font-medium text-muted">Ranking mode</label>
        <div className="mt-1 grid grid-cols-2 gap-1 rounded-[var(--radius)] bg-background p-1">
          {["hybrid", "structured"].map((m) => (
            <button key={m} data-testid={`mode-${m}`} onClick={() => p.setMode(m)}
              className={`rounded-[calc(var(--radius)-3px)] px-2 py-1.5 text-sm font-medium capitalize transition ${p.mode === m ? "bg-accent text-white shadow-sm" : "text-muted hover:text-foreground"}`}>
              {m}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[11px] leading-tight text-muted">
          {p.mode === "hybrid"
            ? "BM25 + vector semantics + filters. Surfaces intent (\"aging re-roof candidates\") a filter UI can't express."
            : "Structured filters only, sorted by solar score."}
        </p>
      </div>

      {/* Building type is controlled by the toggle on the ranked-prospects panel (top-right). */}
      <Select label="Roof type" value={f.roof_type} onChange={(v) => up("roof_type", v)}
        options={[["", "Any"], ["flat", "Flat"], ["pitched", "Pitched"]]} />
      <Range label={`Min roof area: ${f.min_area_sqft.toLocaleString()} sqft`} min={0} max={100000} step={5000}
        value={f.min_area_sqft} onChange={(v) => up("min_area_sqft", v)} />
      <Range label={`Min sun: ${f.min_sunshine} kWh/kW/yr`} min={0} max={1900} step={25}
        value={f.min_sunshine} onChange={(v) => up("min_sunshine", v)} />
      <Range label={`Min roof age: ${f.min_roof_age} yrs`} min={0} max={35} step={1}
        value={f.min_roof_age} onChange={(v) => up("min_roof_age", v)} />
      <Check label="South-facing only (135–225°)" checked={f.southFacing} onChange={(v) => up("southFacing", v)} />
      <Check label="Owner-occupied only" checked={f.owner_occupied} onChange={(v) => up("owner_occupied", v)} />
      <Check label="Exclude HOA-restricted" checked={f.exclude_hoa} onChange={(v) => up("exclude_hoa", v)} />

      <button onClick={p.onSearch} disabled={p.loading}
        className="w-full rounded-[var(--radius)] bg-accent px-3 py-2 text-sm font-semibold text-white transition hover:bg-accent-strong disabled:opacity-50">
        {p.loading ? "Searching…" : "Search this area"}
      </button>
      {p.tookMs != null && <p className="text-center text-xs text-muted">{p.total} prospects · {p.tookMs} ms</p>}
    </div>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-[var(--radius)] border border-border bg-surface p-2 text-sm outline-none focus:border-accent">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

function Range({ label, min, max, step, value, onChange }: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))} className="mt-1 w-full accent-[var(--accent)]" />
    </label>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-[var(--accent)]" />
      <span>{label}</span>
    </label>
  );
}

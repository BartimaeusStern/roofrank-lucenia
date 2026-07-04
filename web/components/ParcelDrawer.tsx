"use client";
import { scoreColor } from "@/lib/geohash.mjs";

export default function ParcelDrawer({ parcel, onClose }: { parcel: any; onClose: () => void }) {
  const p = parcel;
  if (!p) return null;
  const isRes = p.building_type === "residential";
  // Google's max_panels fills the WHOLE roof; a home is sized to usage, not max fill.
  // Cap the residential quote at a realistic home system so a big roof doesn't quote 50 kW.
  const RES_MAX_KW = 12;
  const rawKw = p.max_panels ? p.max_panels * 0.4 : null;           // 400W panels, full roof potential
  const kw = rawKw == null ? null : Math.round(isRes ? Math.min(rawKw, RES_MAX_KW) : rawKw);
  const frac = rawKw && kw ? kw / rawKw : 1;                        // share of roof potential quoted
  const quotePanels = kw ? Math.round(kw / 0.4) : null;
  const quoteKwh = p.annual_kwh_dc != null ? p.annual_kwh_dc * frac : null; // scale production to the quoted system
  // Residential installs cost more per watt than commercial and take the §25D credit, not §48E.
  const dollarsPerW = isRes ? 3.5 : 2.8;
  const gross = kw ? Math.round(kw * dollarsPerW * 1000) : null;
  const netCost = gross != null ? Math.round(gross * 0.7) : null; // after the ~30% tax credit (§25D / §48E)
  // Savings at retail power price: residential ~$0.14/kWh (TX avg), commercial uses the ingest estimate.
  const savings = isRes
    ? (quoteKwh != null ? Math.round(quoteKwh * 0.14) : null)
    : (p.est_annual_savings_usd != null ? Math.round(p.est_annual_savings_usd) : null);
  const pricePerSqft = p.list_price && p.living_sqft ? Math.round(p.list_price / p.living_sqft) : null;
  return (
    <div data-testid="drawer" className="absolute inset-y-0 right-0 z-20 w-[420px] max-w-full overflow-y-auto border-l border-border bg-panel shadow-2xl">
      <div className="flex items-start justify-between border-b border-border p-4">
        <div>
          <h3 className="font-semibold leading-tight">{p.address}</h3>
          <p className="text-xs capitalize text-muted">{p.building_type} · {p.roof_type} · {p.city}, {p.state}</p>
        </div>
        <button onClick={onClose} aria-label="Close" className="rounded px-2 py-1 text-muted hover:bg-background">✕</button>
      </div>

      <div className="space-y-4 p-4">
        <div className="flex items-center gap-3">
          <span className="rounded-lg px-3 py-1 text-lg font-bold text-white" style={{ background: scoreColor(p.solar_score) }}>
            {Math.round(p.solar_score)}
          </span>
          <span className="text-sm text-muted">solar score{p.data_source === "google" ? " · live Google Solar" : " · synthetic"}</span>
        </div>

        <div className="flex flex-wrap gap-3 text-xs">
          {p.listing_url && (
            <a href={p.listing_url} target="_blank" rel="noopener noreferrer"
              className="font-medium text-accent-strong underline underline-offset-2">View listing ↗</a>
          )}
          {isRes && (
            // The zillow.com/homes/{addr}_rb/ form does not resolve without a zpid we don't have.
            // A Google search for the address reliably lands on the correct Zillow detail page.
            <a href={`https://www.google.com/search?q=${encodeURIComponent(p.address + " zillow")}`} target="_blank" rel="noopener noreferrer"
              className="font-medium text-accent-strong underline underline-offset-2">Find on Zillow ↗</a>
          )}
          {p.centroid && (
            <a href={`https://www.google.com/maps/search/?api=1&query=${p.centroid.lat},${p.centroid.lon}`} target="_blank" rel="noopener noreferrer"
              className="font-medium text-muted underline underline-offset-2">Map ↗</a>
          )}
        </div>
        {p.list_price != null && (
          <p className="text-sm">
            <span className="text-muted">List price</span>{" "}
            <span className="font-semibold">${Number(p.list_price).toLocaleString()}</span>
            {p.beds ? ` · ${p.beds} bd` : ""}{p.baths ? ` · ${p.baths} ba` : ""}
            {p.living_sqft ? ` · ${Number(p.living_sqft).toLocaleString()} sqft` : ""}
            {pricePerSqft ? ` · $${pricePerSqft.toLocaleString()}/sqft` : ""}
          </p>
        )}

        <div className="grid grid-cols-2 gap-2 text-sm">
          <Metric k="Usable roof" v={`${Math.round(p.usable_roof_area_sqft).toLocaleString()} sqft`} />
          <Metric k="Max panels" v={p.max_panels?.toLocaleString()} />
          <Metric k="Annual output" v={`${Math.round(p.annual_kwh_dc / 1000).toLocaleString()} MWh`} />
          <Metric k="Sun" v={`${p.sunshine_kwh_per_kw_yr} kWh/kW`} />
          <Metric k="Orientation" v={p.best_azimuth_deg != null ? `${Math.round(p.best_azimuth_deg)}° az / ${Math.round(p.best_pitch_deg)}° pitch` : "—"} />
          <Metric k="Roof age" v={p.roof_age_years != null ? `${p.roof_age_years} yrs` : "unknown"} />
          <Metric k="Owner-occupied" v={p.owner_occupied ? "Yes" : "No"} />
          <Metric k="Imagery" v={p.imagery_quality || "—"} />
        </div>

        <div className="rounded-[var(--radius)] border border-border p-3">
          <h4 className="text-sm font-semibold">Draft solar quote</h4>
          <div className="mt-2 space-y-1 text-sm">
            <Row k="System size" v={kw ? `${kw.toLocaleString()} kW DC (${quotePanels} panels)` : "—"} />
            <Row k="Est. annual production" v={quoteKwh != null ? `${(quoteKwh / 1000).toFixed(isRes ? 1 : 0)} MWh` : "—"} />
            <Row k={`Est. gross cost (@ $${dollarsPerW.toFixed(2)}/W)`} v={gross ? `$${gross.toLocaleString()}` : "—"} />
            <Row k="Net cost after 30% credit" v={netCost ? `$${netCost.toLocaleString()}` : "—"} />
            <Row k="Est. annual savings" v={savings ? `$${savings.toLocaleString()}` : "—"} />
            <Row k="Payback (on net cost)" v={netCost && savings ? `${(netCost / savings).toFixed(1)} yrs` : "—"} />
          </div>
          <p className="mt-2 text-[11px] text-muted">
            {isRes
              ? `Illustrative, sized to a typical home (this roof could fit ~${p.max_panels?.toLocaleString()} panels). §25D (owner-purchased) expired 2025-12-31; third-party-owned lease/PPA systems still capture ~30% via §48E (placed in service by 2027-12-31).`
              : "Illustrative. The ~30% §48E commercial credit applies to systems placed in service by 2027-12-31."}
          </p>
        </div>

        <RoofSunlight segments={p.roof_segments} />

        {p.data_source === "google" && (
          <p className="border-t border-border pt-2 text-[11px] text-muted">Source: Includes solar data from Google</p>
        )}
      </div>
    </div>
  );
}

function Metric({ k, v }: { k: string; v: any }) {
  return (
    <div className="rounded-md bg-background p-2">
      <div className="text-[11px] text-muted">{k}</div>
      <div className="font-medium">{v ?? "—"}</div>
    </div>
  );
}
function Row({ k, v }: { k: string; v: any }) {
  return <div className="flex justify-between"><span className="text-muted">{k}</span><span className="font-medium">{v}</span></div>;
}

// Roof sunlight diagram: each real roof segment as a tile, sized by area and shaded in a
// purple gradient by its annual sun (per-segment median from Google Solar sunshineQuantiles).
// Darker + more opaque = more sun. Hidden for synthetic parcels (no real per-segment sunshine).
function RoofSunlight({ segments }: { segments?: any[] }) {
  const segs = (segments || []).filter((s) => typeof s.sunshine === "number" && s.sunshine > 0);
  if (segs.length < 1) return null;
  const suns = segs.map((s) => s.sunshine);
  const min = Math.min(...suns), max = Math.max(...suns), span = max - min || 1;
  return (
    <div data-testid="roof-sunlight" className="rounded-[var(--radius)] border border-border p-3">
      <h4 className="text-sm font-semibold">Roof sunlight</h4>
      <p className="mt-0.5 text-[11px] text-muted">Annual sun by roof segment (Google Solar). Darker = more sun.</p>
      <div className="mt-2 flex h-24 gap-0.5 overflow-hidden rounded-md">
        {segs.map((s, i) => {
          const t = (s.sunshine - min) / span;          // 0..1 relative sun
          const opacity = 0.25 + 0.75 * t;               // more sun = more opaque
          return (
            <div key={i} title={`${Math.round(s.sunshine).toLocaleString()} sun-hrs/yr · ${Math.round(s.area_sqft).toLocaleString()} sqft · ${Math.round(s.azimuth_deg)}° az`}
              className="flex items-end justify-center pb-1 text-[9px] font-semibold text-white/90"
              style={{ flexGrow: Math.max(s.area_sqft || 1, 1), background: `rgba(124, 58, 237, ${opacity.toFixed(2)})` }}>
              {Math.round(s.azimuth_deg)}°
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] text-muted">
        <span>less sun</span>
        <div className="h-1.5 flex-1 mx-2 rounded" style={{ background: "linear-gradient(90deg, rgba(124,58,237,0.25), rgba(124,58,237,1))" }} />
        <span>more sun</span>
      </div>
    </div>
  );
}

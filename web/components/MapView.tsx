"use client";
import { APIProvider, Map, AdvancedMarker, useMap } from "@vis.gl/react-google-maps";
import { useEffect, useRef, useState } from "react";
import { decodeGeohashBounds, scoreColor } from "@/lib/geohash.mjs";

declare const google: any;
const KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
const MAP_ID = "roofrank-map";

type Bounds = { top_left?: { lat: number; lon: number }; bottom_right?: { lat: number; lon: number } } | null;

export default function MapView({ results, heat, onBounds, onSelect, selectedId, theme, bounds, onPolygon, onClearPolygon, hasPolygon }: {
  results: any[]; heat: any[]; onBounds: (b: any) => void; onSelect: (id: string) => void; selectedId?: string; theme?: string;
  bounds?: Bounds; onPolygon?: (pts: { lat: number; lon: number }[]) => void; onClearPolygon?: () => void; hasPolygon?: boolean;
}) {
  if (!KEY) return <Fallback />;
  const dark = theme === "dark";
  return (
    <APIProvider apiKey={KEY}>
      <Map
        id={MAP_ID}
        defaultCenter={{ lat: 32.82, lng: -96.9 }} defaultZoom={10}
        mapId="DEMO_MAP_ID" gestureHandling="greedy" clickableIcons={false}
        colorScheme={dark ? "DARK" : "LIGHT"}
        style={{ width: "100%", height: "100%" }}
        onCameraChanged={(ev: any) => {
          const b = ev?.detail?.bounds;
          if (b) onBounds({ minLat: b.south, maxLat: b.north, minLon: b.west, maxLon: b.east });
        }}
      >
        <HeatLayer cells={heat} onCellClick={onSelect} />
        {results.map((r) => r.centroid && (
          <AdvancedMarker key={r.id} position={{ lat: r.centroid.lat, lng: r.centroid.lon }}
            onClick={() => onSelect(r.id)} zIndex={selectedId === r.id ? 999 : undefined}>
            <div style={{
              width: selectedId === r.id ? 18 : 12, height: selectedId === r.id ? 18 : 12,
              borderRadius: "50%", background: scoreColor(r.solar_score),
              border: `2px solid ${selectedId === r.id ? (dark ? "#f8fafc" : "#0f172a") : "#ffffff"}`,
              boxShadow: "0 1px 3px rgba(0,0,0,.4)",
            }} />
          </AdvancedMarker>
        ))}
      </Map>
      <MapControls bounds={bounds} onPolygon={onPolygon} onClearPolygon={onClearPolygon} hasPolygon={hasPolygon} />
      <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-panel/90 px-2 py-1 text-[11px] text-muted">
        Marker + cell shade = solar score · click a heat cell for its best roof · Source: Includes solar data from Google
      </div>
    </APIProvider>
  );
}

// Draws the geohash heat cells as colored rectangles; each cell is clickable and opens its
// best-scoring prospect (top_id from the top_hits sub-aggregation).
function HeatLayer({ cells, onCellClick }: { cells: any[]; onCellClick: (id: string) => void }) {
  const map = useMap(MAP_ID);
  useEffect(() => {
    if (!map || typeof google === "undefined") return;
    const rects = cells.map((c) => {
      const b = decodeGeohashBounds(c.key);
      const rect = new google.maps.Rectangle({
        map, bounds: { north: b.north, south: b.south, east: b.east, west: b.west },
        fillColor: scoreColor(c.avg_score), fillOpacity: 0.22,
        strokeColor: scoreColor(c.avg_score), strokeOpacity: 0.35, strokeWeight: 1, clickable: !!c.top_id,
      });
      if (c.top_id) rect.addListener("click", () => onCellClick(c.top_id));
      return rect;
    });
    return () => rects.forEach((r: any) => { google.maps.event.clearInstanceListeners(r); r.setMap(null); });
  }, [map, cells, onCellClick]);
  return null;
}

// Map overlay controls: "Fit to results" (geo_bounds) + draw/clear a polygon region (geo_polygon).
// DrawingManager was removed from the Maps JS API in v3.65, so we collect polygon vertices by
// listening for map clicks and drawing a plain (non-deprecated) google.maps.Polygon.
function MapControls({ bounds, onPolygon, onClearPolygon, hasPolygon }: {
  bounds?: Bounds; onPolygon?: (pts: { lat: number; lon: number }[]) => void; onClearPolygon?: () => void; hasPolygon?: boolean;
}) {
  const map = useMap(MAP_ID);
  const overlayRef = useRef<any>(null);  // the drawn google.maps.Polygon
  const clickRef = useRef<any>(null);    // map click listener, active only while drawing
  const [drawing, setDrawing] = useState(false);
  const [count, setCount] = useState(0); // vertices placed so far

  const removeOverlay = () => { if (overlayRef.current) { overlayRef.current.setMap(null); overlayRef.current = null; } };
  const stopDrawing = () => { if (clickRef.current) { google.maps.event.removeListener(clickRef.current); clickRef.current = null; } setDrawing(false); };

  const startDrawing = () => {
    if (!map) return;
    removeOverlay();
    setCount(0);
    const poly: any = new google.maps.Polygon({
      map, paths: [], editable: true, clickable: false,
      fillColor: "#7c3aed", fillOpacity: 0.12, strokeColor: "#7c3aed", strokeWeight: 2,
    });
    overlayRef.current = poly;
    setDrawing(true);
    clickRef.current = map.addListener("click", (e: any) => { poly.getPath().push(e.latLng); setCount((c) => c + 1); });
  };

  const finish = () => {
    stopDrawing();
    const path = overlayRef.current?.getPath();
    if (!path || path.getLength() < 3) { removeOverlay(); onClearPolygon?.(); return; }
    // Google paths are {lat, lng}; convert lng -> lon at this boundary (the query layer uses lon).
    const pts = path.getArray().map((ll: any) => ({ lat: ll.lat(), lon: ll.lng() }));
    onPolygon?.(pts);
  };

  const clear = () => { stopDrawing(); removeOverlay(); onClearPolygon?.(); };

  useEffect(() => () => { if (clickRef.current) google.maps.event.removeListener(clickRef.current); removeOverlay(); }, []);

  const fit = () => {
    const tl = bounds?.top_left, br = bounds?.bottom_right;
    if (!map || !tl || !br) return;
    const b = new google.maps.LatLngBounds({ lat: br.lat, lng: tl.lon }, { lat: tl.lat, lng: br.lon }); // (SW, NE)
    map.fitBounds(b, 60);
    google.maps.event.addListenerOnce(map, "idle", () => { if ((map.getZoom() ?? 0) > 16) map.setZoom(16); }); // clamp tiny/single bounds
  };

  const btn = "rounded-md bg-panel/95 px-2 py-1 text-xs font-medium text-foreground shadow ring-1 ring-border hover:bg-background";
  return (
    <div className="absolute right-2 top-2 z-10 flex gap-1">
      <button data-testid="fit-results" onClick={fit} disabled={!bounds} className={`${btn} disabled:opacity-40`}>Fit to results</button>
      {drawing ? (
        <>
          <button data-testid="finish-region" onClick={finish} disabled={count < 3} className={`${btn} disabled:opacity-40`}>Finish region ({count})</button>
          <button onClick={clear} className={btn}>Cancel</button>
        </>
      ) : hasPolygon ? (
        <button data-testid="clear-region" onClick={clear} className={btn}>Clear region ✕</button>
      ) : (
        <button data-testid="draw-region" onClick={startDrawing} className={btn}>Draw region</button>
      )}
    </div>
  );
}

function Fallback() {
  return (
    <div className="flex h-full items-center justify-center bg-background p-8 text-center text-sm text-muted">
      Map unavailable. Set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY and enable the Maps JavaScript API.
      The ranked list and search still work.
    </div>
  );
}

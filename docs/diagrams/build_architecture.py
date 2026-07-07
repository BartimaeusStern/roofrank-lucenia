#!/usr/bin/env python3
"""Generate a detailed RoofRank architecture diagram as an .excalidraw file.

excalidraw-cli's DOT path can't nest boxes, so we emit the JSON directly: each
stage is a big titled container holding small boxes that name its concrete parts.
Render with:  excalidraw-cli convert docs/diagrams/architecture.excalidraw --format svg
"""
import json, random, os

AMBER = "#d97706"
INK = "#1e1e1e"
elements = []
_i = [0]

def _idx():
    _i[0] += 1
    return f"a{_i[0]:03d}"

def rect(x, y, w, h, color=INK, rounded=True):
    elements.append({
        "id": f"r{random.randint(10**9,10**10)}", "type": "rectangle",
        "x": x, "y": y, "width": w, "height": h, "angle": 0,
        "strokeColor": color, "backgroundColor": "transparent", "fillStyle": "solid",
        "strokeWidth": 2, "strokeStyle": "solid", "roughness": 1, "opacity": 100,
        "groupIds": [], "frameId": None, "index": _idx(), "roundness": {"type": 3},
        "seed": random.randint(1,10**9), "version": 1, "versionNonce": random.randint(1,10**9),
        "isDeleted": False, "boundElements": None, "updated": 1783385390000,
        "link": None, "locked": False,
    })

def text(x, y, w, h, s, size=16, color=INK):
    elements.append({
        "id": f"t{random.randint(10**9,10**10)}", "type": "text",
        "x": x, "y": y, "width": w, "height": h, "angle": 0,
        "strokeColor": color, "backgroundColor": "transparent", "fillStyle": "solid",
        "strokeWidth": 2, "strokeStyle": "solid", "roughness": 1, "opacity": 100,
        "groupIds": [], "frameId": None, "index": _idx(), "roundness": None,
        "seed": random.randint(1,10**9), "version": 1, "versionNonce": random.randint(1,10**9),
        "isDeleted": False, "boundElements": None, "updated": 1783385390000,
        "link": None, "locked": False, "text": s, "fontSize": size, "fontFamily": 5,
        "textAlign": "center", "verticalAlign": "middle", "containerId": None,
        "originalText": s, "autoResize": True, "lineHeight": 1.25,
    })

def arrow(x1, y1, x2, y2):
    elements.append({
        "id": f"a{random.randint(10**9,10**10)}", "type": "arrow",
        "x": x1, "y": y1, "width": abs(x2-x1), "height": abs(y2-y1), "angle": 0,
        "strokeColor": INK, "backgroundColor": "transparent", "fillStyle": "solid",
        "strokeWidth": 2, "strokeStyle": "solid", "roughness": 1, "opacity": 100,
        "groupIds": [], "frameId": None, "index": _idx(), "roundness": {"type": 2},
        "seed": random.randint(1,10**9), "version": 1, "versionNonce": random.randint(1,10**9),
        "isDeleted": False, "boundElements": None, "updated": 1783385390000, "link": None,
        "locked": False, "points": [[0,0],[x2-x1,y2-y1]], "lastCommittedPoint": None,
        "startBinding": None, "endBinding": None, "startArrowhead": None, "endArrowhead": "arrow",
        "elbowed": False,
    })

W, IW, IH, GAP, TITLE_H, PAD = 300, 268, 44, 12, 46, 16

def container(cx, mid_y, title, items):
    """Draw a big titled box centered vertically on mid_y; return (x, y, w, h)."""
    h = TITLE_H + len(items)*IH + (len(items)-1)*GAP + PAD
    y = mid_y - h/2
    rect(cx, y, W, h, color=AMBER)
    text(cx, y+10, W, 26, title, size=19, color=AMBER)
    iy = y + TITLE_H
    for it in items:
        rect(cx+(W-IW)/2, iy, IW, IH, color=INK)
        text(cx+(W-IW)/2, iy, IW, IH, it, size=14, color=INK)
        iy += IH + GAP
    return cx, y, W, h

# columns
C0, C1, C2, C3 = 40, 440, 840, 1260
ING, QRY, LUC = 175, 575, 375

p = container(C0, ING, "Parcel source", ["400 synthetic commercial", "6 live Google-Solar", "~100 residential (75218)"])
s = container(C1, ING, "Google Solar API", ["buildingInsights.findClosest", "roofSegmentStats", "solarPanelConfigs (kWh)", "maxSunshineHoursPerYear"])
t = container(C2, ING, "transform + score + embed", ["map roof fields (toParcel)", "solar_score 0-100", "MiniLM 384-dim embed", "bulk index into Lucenia"])
l = container(C3, LUC, "Lucenia (Docker)", ["parcels index", "geo_point + knn_vector + text", "hybrid BM25 + kNN fusion", "geohash_grid heat agg"])
u = container(C1, QRY, "Next.js UI", ["map + heat + draw region", "filters + NL search", "ranked list + parcel drawer"])
h = container(C2, QRY, "Route handlers", ["/api/search (hybrid)", "/api/heatmap (geohash)", "/api/parcel/[id]", "opensearch-js client"])

def right(c): return c[0]+c[2]
def left(c):  return c[0]
def cy(c):    return c[1]+c[3]/2

arrow(right(p), ING, left(s), ING)              # ingest
arrow(right(s), ING, left(t), ING)
arrow(right(t), ING, left(l), cy(l)-30)         # into Lucenia (down)
arrow(right(u), QRY, left(h), QRY)              # query
arrow(right(h), QRY, left(l), cy(l)+30)         # into Lucenia (up)

# stage labels on the two flows
text(right(p)+18, ING-30, 64, 20, "ingest", size=13, color=INK)
text(right(u)+18, QRY-30, 64, 20, "query", size=13, color=INK)

doc = {"type": "excalidraw", "version": 2, "source": "roofrank", "elements": elements,
       "appState": {"gridSize": None, "viewBackgroundColor": "#ffffff"}, "files": {}}
out = os.path.join(os.path.dirname(__file__), "architecture.excalidraw")
with open(out, "w") as f:
    json.dump(doc, f)
print("wrote", out, "with", len(elements), "elements")

// End-to-end verification via Playwright (headless chromium). Drives the real
// app + Lucenia and asserts the core flow. Usage: node scripts/e2e.mjs
import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:3000";
const results = {};
const errors = [];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

const topN = () => page.$$eval('[data-testid="result"]', (els) =>
  els.slice(0, 8).map((e) => ({ id: e.dataset.id, score: Number(e.dataset.score) })));

try {
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("text=RoofRank", { timeout: 20000 });
  results.header = true;

  // initial (hybrid) results load
  await page.waitForSelector('[data-testid="result"]', { timeout: 40000 });
  const hybrid = await topN();
  results.hybridTop = hybrid.slice(0, 5).map((r) => r.id);

  // toggle to structured -> refetch
  await page.click('[data-testid="mode-structured"]');
  await page.waitForFunction(
    (firstHybrid) => {
      const els = document.querySelectorAll('[data-testid="result"]');
      return els.length > 0 && els[0].dataset.id !== firstHybrid;
    },
    hybrid[0].id, { timeout: 15000 }
  ).catch(() => {});
  const structured = await topN();
  results.structuredTop = structured.slice(0, 5).map((r) => r.id);
  results.moneyShot_reordered = JSON.stringify(results.hybridTop) !== JSON.stringify(results.structuredTop);
  results.structured_sorted_by_score_desc = structured.every((r, i, a) => i === 0 || a[i - 1].score >= r.score);

  // back to hybrid, open a parcel drawer
  await page.click('[data-testid="mode-hybrid"]');
  await page.waitForSelector('[data-testid="result"]', { timeout: 15000 });
  await page.click('[data-testid="result"]');
  await page.waitForSelector('[data-testid="drawer"]', { timeout: 15000 });
  results.drawer_opens = true;
  results.drawer_has_quote = (await page.locator('[data-testid="drawer"]').getByText("Draft solar quote").count()) > 0;

  // sort toggle: click "Solar" -> list is score-descending; click again -> ascending
  await page.click('[data-testid="sort-solar"]');
  await page.waitForTimeout(300);
  const solarDesc = await topN();
  results.sort_solar_desc = solarDesc.every((r, i, a) => i === 0 || a[i - 1].score >= r.score);
  await page.click('[data-testid="sort-solar"]');
  await page.waitForTimeout(300);
  const solarAsc = await topN();
  results.sort_solar_asc = solarAsc.every((r, i, a) => i === 0 || a[i - 1].score <= r.score);
  await page.click('[data-testid="sort-clear"]'); // back to Best match

  // building-type toggle: Residential-only refetches to a different, non-empty set
  const beforeBt = (await topN()).map((r) => r.id);
  await page.click('[data-testid="bt-residential"]');
  await page.waitForFunction(
    (firstId) => { const e = document.querySelector('[data-testid="result"]'); return e && e.dataset.id !== firstId; },
    beforeBt[0], { timeout: 15000 }
  ).catch(() => {});
  const resOnly = await topN();
  results.bt_residential_nonempty = resOnly.length > 0;
  results.bt_residential_changed = JSON.stringify(resOnly.map((r) => r.id)) !== JSON.stringify(beforeBt);

  // residential quote must be house-scale, not commercial (task 4): system size <= 15 kW DC.
  // Close the earlier (commercial) drawer first so we read the residential parcel, not a stale one.
  await page.click('[data-testid="drawer"] [aria-label="Close"]').catch(() => {});
  await page.waitForSelector('[data-testid="drawer"]', { state: "detached", timeout: 5000 }).catch(() => {});
  await page.click('[data-testid="result"]');
  await page.waitForSelector('[data-testid="drawer"]', { timeout: 15000 });
  await page.waitForFunction(() => /kW DC/.test(document.querySelector('[data-testid="drawer"]')?.innerText || ""), { timeout: 10000 }).catch(() => {});
  const sizeText = await page.locator('[data-testid="drawer"]').getByText(/kW DC/).first().innerText().catch(() => "");
  const kwMatch = sizeText.match(/([\d,]+)\s*kW DC/);
  results.residential_quote_kw = kwMatch ? Number(kwMatch[1].replace(/,/g, "")) : null;
  results.residential_quote_house_scale = results.residential_quote_kw != null && results.residential_quote_kw <= 15;
  await page.click('[data-testid="drawer"] [aria-label="Close"]').catch(() => {});
  await page.click('[data-testid="bt-both"]'); // restore

  // collapsible filter panel
  await page.click('[data-testid="panel-collapse"]');
  results.panel_collapses = (await page.locator('[data-testid="panel-expand"]').count()) > 0;
  // dark-mode toggle is also present on the collapsed rail; flipping it toggles the .dark class on <html>
  const railBefore = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  await page.click('[data-testid="theme-toggle"]');
  await page.waitForTimeout(150);
  const railAfter = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  results.theme_toggles = railBefore !== railAfter;
  await page.click('[data-testid="theme-toggle"]'); // restore
  await page.click('[data-testid="panel-expand"]');

  // new Lucenia-backed map controls: Fit to results (geo_bounds) + Draw region (geo_polygon)
  results.fit_button = (await page.locator('[data-testid="fit-results"]').count()) > 0;
  results.draw_button = (await page.locator('[data-testid="draw-region"]').count()) > 0;
  await page.click('[data-testid="draw-region"]');
  results.draw_mode_enters = (await page.locator('[data-testid="finish-region"]').count()) > 0;
  await page.getByText("Cancel", { exact: true }).click().catch(() => {});
  // percentiles stat (top-decile solar score in view) renders in the results header
  results.top10_stat = (await page.getByText(/Top 10% of roofs/).count()) > 0;

  // "Both" mode must return residential AND commercial, each with a centroid — the map draws a
  // dot per result-with-centroid, so this guards the bug where residential never made the top-N
  // and only the heatmap shaded their area.
  const both = await fetch(`${BASE}/api/search`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nl: "aging flat warehouse roofs, re-roof plus solar candidates", mode: "hybrid",
      filters: { exclude_hoa: true }, bbox: { minLat: 32.6, maxLat: 33.05, minLon: -97.45, maxLon: -96.55 }, size: 600 }),
  }).then((r) => r.json());
  const bothTypes = new Set((both.results || []).map((r) => r.building_type));
  results.both_has_residential = bothTypes.has("residential");
  results.both_has_commercial = bothTypes.has("commercial");
  results.both_all_have_centroid = (both.results || []).length > 0 && (both.results || []).every((r) => r.centroid);

  // map: loaded vs graceful fallback
  results.map_fallback = (await page.getByText("Map unavailable").count()) > 0;
  results.map_present = (await page.locator("main gmp-internal-camera-control, main canvas, main img[src*='googleapis']").count()) > 0;

  await page.screenshot({ path: "/tmp/roofrank-e2e.png" });
  results.screenshot = "/tmp/roofrank-e2e.png";
} catch (e) {
  results.fatal = String(e);
}
results.pageErrors = errors.slice(0, 8);

const pass = results.header && results.hybridTop?.length && results.moneyShot_reordered
  && results.structured_sorted_by_score_desc && results.drawer_opens && results.drawer_has_quote
  && results.sort_solar_desc && results.sort_solar_asc
  && results.bt_residential_nonempty && results.residential_quote_house_scale && results.panel_collapses
  && results.both_has_residential && results.both_has_commercial && results.both_all_have_centroid
  && results.theme_toggles
  && results.fit_button && results.draw_button && results.draw_mode_enters && results.top10_stat
  && !results.fatal;
console.log(JSON.stringify(results, null, 2));
console.log(pass ? "\nE2E PASS" : "\nE2E: SOME CHECKS FAILED");
await browser.close();
process.exit(pass ? 0 : 1);

// Backfill year_built onto data/redfin-75218.json by scraping each Redfin detail page
// via the Firecrawl CLI. Redfin renders "<year>Year Built" (value precedes label), e.g.
// "1962Year Built". We parse that and write year_built back into the JSON so enrich-redfin
// can turn it into a real roof_age_years (fixing "Roof age unknown"). Idempotent: skips
// listings that already carry year_built. Usage: node scripts/scrape-year-built.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);

const FILE = new URL("../data/redfin-75218.json", import.meta.url);
const listings = JSON.parse(readFileSync(FILE));
let done = 0, hit = 0;
for (const L of listings) {
  if (L.year_built || !L.url) { done++; continue; }
  try {
    const { stdout } = await run("firecrawl", ["scrape", L.url, "--format", "markdown"], { maxBuffer: 20 * 1024 * 1024 });
    const m = stdout.match(/\b(1[89]\d{2}|20\d{2})Year Built/);
    if (m) { L.year_built = Number(m[1]); hit++; console.log(`[year] ${L.address} -> ${L.year_built}`); }
    else console.log(`[year] ${L.address} -> not found`);
  } catch (e) {
    console.log(`[year] ${L.address} -> scrape failed (${String(e).slice(0, 60)})`);
  }
  done++;
  if (done % 5 === 0) writeFileSync(FILE, JSON.stringify(listings, null, 2) + "\n"); // periodic save
}
writeFileSync(FILE, JSON.stringify(listings, null, 2) + "\n");
console.log(`[year] done. ${hit}/${listings.length} listings got year_built.`);

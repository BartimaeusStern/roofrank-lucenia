// M2 seed: recreate index + pipeline, generate synthetic parcels, embed, bulk index.
// Usage: node scripts/seed.mjs [count]
import { recreateIndex } from "../lib/schema.mjs";
import { client, INDEX } from "../lib/engine.mjs";
import { generateParcels } from "../lib/generate.mjs";
import { embedMany } from "../lib/embed.mjs";

const N = Number(process.argv[2] || 400);
console.log(`[seed] recreating index...`);
await recreateIndex();

console.log(`[seed] generating ${N} synthetic DFW commercial parcels...`);
const parcels = generateParcels(N);

console.log(`[seed] embedding ${N} descriptions with local MiniLM (first run downloads the model)...`);
const vecs = await embedMany(parcels.map((p) => p.description));
parcels.forEach((p, i) => (p.description_vector = vecs[i]));

console.log(`[seed] bulk indexing...`);
const CH = 200;
for (let i = 0; i < parcels.length; i += CH) {
  const body = [];
  for (const p of parcels.slice(i, i + CH)) { body.push({ index: { _index: INDEX, _id: p.parcel_id } }); body.push(p); }
  const { body: res } = await client.bulk({ refresh: true, body });
  if (res.errors) {
    const bad = res.items.find((x) => x.index && x.index.error);
    console.error("[seed] bulk error:", JSON.stringify(bad?.index?.error));
    process.exit(1);
  }
}
const { body: c } = await client.count({ index: INDEX });
console.log(`[seed] done. ${c.count} docs indexed.`);
process.exit(0);

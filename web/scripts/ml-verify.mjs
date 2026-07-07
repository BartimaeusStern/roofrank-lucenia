// Smoke-tests the in-engine "why this roof" generation end-to-end against the live
// node, via the deployed model's `_predict` (the path the app uses). NOTE: we do NOT
// use the `retrieval_augmented_generation` search pipeline — that processor is broken
// on skylite 0.11.x (async-wiring bug). Usage: node --env-file=.env scripts/ml-verify.mjs [parcel_id]
import { client, INDEX } from "../lib/engine.mjs";
import { buildWhyMessages, parseWhy } from "../lib/why.mjs";

const MODEL_NAME = "RoofRank bedrock LLM";
const parcelId = process.argv[2] || "syn-200";

const req = async (method, path, body) => (await client.transport.request({ method, path, body })).body;

const found = await req("POST", "/_plugins/_ml/models/_search", {
  query: { bool: { must: [{ term: { "name.keyword": MODEL_NAME } }, { term: { model_state: "DEPLOYED" } }] } },
  size: 1, _source: false,
});
const modelId = found?.hits?.hits?.[0]?._id;
if (!modelId) { console.error(`No deployed model "${MODEL_NAME}". Run: LLM_PROVIDER=bedrock node --env-file=.env scripts/ml-setup.mjs`); process.exit(1); }

const { body: doc } = await client.get({ index: INDEX, id: parcelId });
const { description_vector, ...parcel } = doc._source ?? {};
console.log("parcel:", parcelId, "-", parcel.address);

const res = await req("POST", `/_plugins/_ml/models/${modelId}/_predict`, { parameters: { messages: buildWhyMessages(parcel) } });
const summary = parseWhy(res);
if (summary) {
  console.log("\n--- why this roof (in-engine) ---\n" + summary);
} else {
  console.error("\nEmpty/unparseable response. Raw shape:\n" + JSON.stringify(res).slice(0, 800));
  process.exit(1);
}
process.exit(0);

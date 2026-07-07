// Lucenia ml-commons foundation for RoofRank's in-engine AI features.
//
// This is the Lucenia-EXCLUSIVE layer: it registers a remote LLM via ml-commons
// and creates the `why-this-roof` search pipeline that uses the
// `retrieval_augmented_generation` response processor to generate a grounded
// "why this roof" prospect summary INSIDE the engine (no app-side LLM call).
// The API routes never see the key or model_id: they call the engine by
// pipeline name, so all credentials stay in the cluster.
//
// PROVIDER SUPPORT ON skylite 0.11.0 / 0.11.1 (verified on the live node):
//   - bedrock (aws_sigv4): WORKS. Deploys + predicts end-to-end. USE THIS.
//   - openai / openrouter (http): the `http` connector executor is BROKEN on
//     this build (HttpJsonConnectorExecutor has no no-arg constructor), so the
//     model FAILS to deploy. Kept here for when Lucenia ships a fix; do not use
//     for in-engine RAG today. See the wiki findings doc.
//
// Usage:  LLM_PROVIDER=bedrock node --env-file=.env scripts/ml-setup.mjs
// Env (bedrock):  AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, [AWS_SESSION_TOKEN],
//                 AWS_REGION (default us-east-1), LLM_MODEL (default Claude Haiku).
//                 The IAM principal needs bedrock:InvokeModel and the model must
//                 have access enabled in the Bedrock console for that region.
import { client } from "../lib/engine.mjs";

const req = async (method, path, body) => {
  const { body: res } = await client.transport.request({ method, path, body });
  return res;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitTask(taskId, label) {
  for (let i = 0; i < 30; i++) {
    const t = await req("GET", `/_plugins/_ml/tasks/${taskId}`);
    if (t.state === "COMPLETED") return t;
    if (t.state === "FAILED") throw new Error(`${label} failed: ${JSON.stringify(t.error || t)}`);
    await sleep(2000);
  }
  throw new Error(`${label} timed out`);
}

async function findByName(kind, name) {
  const path = kind === "connector" ? "/_plugins/_ml/connectors/_search" : "/_plugins/_ml/models/_search";
  try {
    const r = await req("POST", path, { query: { term: { "name.keyword": name } }, size: 1 });
    const hit = r?.hits?.hits?.[0];
    return hit ? { id: hit._id, src: hit._source } : null;
  } catch {
    return null;
  }
}

const PROVIDERS = {
  // WORKING in-engine path on skylite 0.11.x.
  bedrock: {
    connectorName: "RoofRank Bedrock Chat",
    defaultModel: "anthropic.claude-3-haiku-20240307-v1:0",
    trustedRegex: null, // bedrock-runtime.*.amazonaws.com is trusted by default
    working: true,
    check() {
      if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
        return "AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY required (IAM user with bedrock:InvokeModel; enable the model in the Bedrock console for the region).";
      }
      return null;
    },
    connector(model) {
      const region = process.env.AWS_REGION || "us-east-1";
      const credential = {
        access_key: process.env.AWS_ACCESS_KEY_ID,
        secret_key: process.env.AWS_SECRET_ACCESS_KEY,
      };
      if (process.env.AWS_SESSION_TOKEN) credential.session_token = process.env.AWS_SESSION_TOKEN;
      return {
        name: this.connectorName,
        description: "RoofRank in-engine RAG connector (Bedrock, aws_sigv4)",
        version: 1,
        protocol: "aws_sigv4",
        parameters: { region, service_name: "bedrock", model, max_tokens: 300, temperature: 0.2, anthropic_version: "bedrock-2023-05-31" },
        credential,
        actions: [
          {
            action_type: "predict",
            method: "POST",
            url: `https://bedrock-runtime.${region}.amazonaws.com/model/${model}/invoke`,
            headers: { "content-type": "application/json" },
            // The RAG processor supplies ${parameters.messages}; Bedrock Anthropic Messages shape.
            request_body:
              '{ "anthropic_version": "${parameters.anthropic_version}", "max_tokens": ${parameters.max_tokens}, "temperature": ${parameters.temperature}, "messages": ${parameters.messages} }',
          },
        ],
      };
    },
  },
  // BROKEN deploy on skylite 0.11.0/0.11.1 (http executor bug). Kept for a future fix.
  openai: {
    connectorName: "RoofRank OpenAI Chat",
    defaultModel: "gpt-4o-mini",
    trustedRegex: null,
    working: false,
    check() { return process.env.OPENAI_API_KEY ? null : "OPENAI_API_KEY required"; },
    connector(model) {
      return {
        name: this.connectorName,
        description: "RoofRank in-engine RAG connector (OpenAI, http)",
        version: 1,
        protocol: "http",
        parameters: { endpoint: "api.openai.com", model, temperature: 0.2 },
        credential: { llm_key: process.env.OPENAI_API_KEY },
        actions: [
          {
            action_type: "predict",
            method: "POST",
            url: "https://${parameters.endpoint}/v1/chat/completions",
            headers: { Authorization: "Bearer ${credential.llm_key}" },
            request_body:
              '{ "model": "${parameters.model}", "messages": ${parameters.messages}, "temperature": ${parameters.temperature} }',
          },
        ],
      };
    },
  },
  openrouter: {
    connectorName: "RoofRank OpenRouter Chat",
    defaultModel: "openai/gpt-4o-mini",
    trustedRegex: "^https://openrouter\\.ai/.*$",
    working: false,
    check() { return process.env.OPENROUTER_API_KEY ? null : "OPENROUTER_API_KEY required"; },
    connector(model) {
      return {
        name: this.connectorName,
        description: "RoofRank in-engine RAG connector (OpenRouter, http)",
        version: 1,
        protocol: "http",
        parameters: { endpoint: "openrouter.ai", model, temperature: 0.2 },
        credential: { llm_key: process.env.OPENROUTER_API_KEY },
        actions: [
          {
            action_type: "predict",
            method: "POST",
            url: "https://${parameters.endpoint}/api/v1/chat/completions",
            headers: { Authorization: "Bearer ${credential.llm_key}" },
            request_body:
              '{ "model": "${parameters.model}", "messages": ${parameters.messages}, "temperature": ${parameters.temperature} }',
          },
        ],
      };
    },
  },
};

async function ensureTrustedEndpoint(regex) {
  if (!regex) return;
  const s = await req("GET", "/_cluster/settings?include_defaults=true");
  const cur = s?.defaults?.plugins?.ml_commons?.trusted_connector_endpoints_regex || [];
  const persisted = s?.persistent?.plugins?.ml_commons?.trusted_connector_endpoints_regex || [];
  const list = Array.from(new Set([...cur, ...persisted]));
  if (list.includes(regex)) return;
  list.push(regex);
  await req("PUT", "/_cluster/settings", {
    persistent: { "plugins.ml_commons.trusted_connector_endpoints_regex": list },
  });
  console.log(`  added trusted endpoint: ${regex}`);
}

async function ensureModel(name, p, model) {
  const existing = await findByName("model", name);
  if (existing && existing.src?.model_state === "DEPLOYED") {
    console.log(`  model exists + deployed: ${existing.id}`);
    return existing.id;
  }
  // Register with an INLINE connector so skylite builds the remote executor at
  // register time.
  const reg = await req("POST", "/_plugins/_ml/models/_register", {
    name,
    function_name: "remote",
    description: "RoofRank remote LLM",
    connector: p.connector(model),
  });
  const modelId = reg.model_id || (await waitTask(reg.task_id, "model register")).model_id;
  const dep = await req("POST", `/_plugins/_ml/models/${modelId}/_deploy`);
  if (dep.task_id) await waitTask(dep.task_id, "model deploy");
  console.log(`  model deployed: ${modelId}`);
  return modelId;
}

// REFERENCE / NOT CURRENTLY USED. Creates a search pipeline that would generate the
// "why this roof" summary in-engine via the `retrieval_augmented_generation` response
// processor (query the index with ?search_pipeline=why-this-roof and the processor
// calls the LLM + injects the answer). This is the "purest" in-engine RAG design.
//
// It is NOT wired up because on skylite 0.11.0/0.11.1 that processor is broken:
// GenerativeQAResponseProcessor.processResponse throws UnsupportedOperationException
// (skylite's processResponseAsync falls through to the sync method) → every query
// through the pipeline errors with `unsupported_operation_exception`. Same async-wiring
// bug that breaks `ml_inference`. Reported upstream.
//
// So the app instead calls the model's `_predict` directly (see app/api/why/[id]/route.ts),
// which works on the aws_sigv4/Bedrock executor. Keep this here to switch back to the
// native RAG pipeline once Lucenia ships a fix (then call it from main() after ensureModel).
async function ensureWhyPipeline(modelId) {
  await req("PUT", "/_search/pipeline/why-this-roof", {
    description: "In-engine grounded 'why this roof' solar-prospect summary (Lucenia RAG).",
    response_processors: [
      {
        retrieval_augmented_generation: {
          tag: "why_this_roof",
          description: "Grounded summary from the parcel's own indexed fields.",
          model_id: modelId,
          context_field_list: ["description", "address", "building_type", "roof_type"],
          system_prompt:
            "You are a solar sales analyst. Using ONLY the provided rooftop facts, explain in plain language why a roof is a strong or weak commercial/residential solar prospect. Never invent numbers; cite the facts you were given.",
          user_instructions:
            "In 2-3 sentences, explain why THIS roof is a good or weak solar prospect. Ground every claim in the provided parcel facts (roof size, sun, orientation, age, panels, savings, payback).",
        },
      },
    ],
  });
  console.log("  pipeline created: why-this-roof");
}

async function main() {
  const provider = (process.env.LLM_PROVIDER || "bedrock").toLowerCase();
  const p = PROVIDERS[provider];
  if (!p) { console.error(`Unknown LLM_PROVIDER '${provider}' (use bedrock | openai | openrouter)`); process.exit(1); }
  if (!p.working) {
    console.error(`WARNING: provider '${provider}' uses the http connector executor, which is BROKEN on skylite 0.11.0/0.11.1 (model will fail to deploy). Use LLM_PROVIDER=bedrock. Continuing anyway…`);
  }
  const keyErr = p.check();
  if (keyErr) { console.error(`${keyErr}\nRun: LLM_PROVIDER=${provider} node --env-file=.env scripts/ml-setup.mjs`); process.exit(1); }
  const model = process.env.LLM_MODEL || p.defaultModel;
  console.log(`RoofRank ml-commons setup — provider=${provider} model=${model}`);

  console.log("1) allow model serving on the data node (dev)…");
  await req("PUT", "/_cluster/settings", { persistent: { "plugins.ml_commons.only_run_on_ml_node": false } });

  if (p.trustedRegex) { console.log("2) ensure trusted endpoint…"); await ensureTrustedEndpoint(p.trustedRegex); }

  console.log("3) model (register inline connector + deploy)…");
  const modelId = await ensureModel(`RoofRank ${provider} LLM`, p, model);

  // NOTE: the `retrieval_augmented_generation` search processor is non-functional on
  // skylite 0.11.x (GenerativeQAResponseProcessor throws UnsupportedOperationException
  // via the same async-wiring bug as ml_inference). So we do NOT rely on the pipeline;
  // the app generates the "why this roof" summary by calling the model's `_predict`
  // directly (still in-engine: Lucenia holds the creds and invokes Bedrock). The
  // pipeline builder is kept below for when Lucenia ships a fix.
  console.log("4) why-this-roof pipeline: SKIPPED (RAG processor broken on this build; app uses _predict).");

  console.log("\nDone. Model id:", modelId, `(name: "RoofRank ${provider} LLM")`);
  console.log("The /api/why/[id] route resolves the model by name; no further config needed.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

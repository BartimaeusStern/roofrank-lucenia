import { NextResponse } from "next/server";
import { client, INDEX } from "@/lib/engine.mjs";
import { buildWhyMessages, parseWhy, parseOpenAI } from "@/lib/why.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The in-engine LLM model is registered by `npm run ml-setup` under this name.
// Generation runs through Lucenia ml-commons `_predict` (creds stay in-cluster).
// This is the primary, Lucenia-exclusive path. When it's unavailable (e.g. the AWS
// Bedrock account isn't authorized yet) we fall back to an app-side OpenAI call
// grounded on the same parcel fields, so the feature is demoable today and
// auto-upgrades to the in-engine path once Bedrock works, no code change.
const MODEL_NAME = "RoofRank bedrock LLM";

let cachedModelId: string | null = null;
async function getModelId(): Promise<string | null> {
  if (cachedModelId) return cachedModelId;
  const { body } = await client.transport.request({
    method: "POST",
    path: "/_plugins/_ml/models/_search",
    body: { query: { bool: { must: [{ term: { "name.keyword": MODEL_NAME } }, { term: { model_state: "DEPLOYED" } }] } }, size: 1, _source: false },
  });
  cachedModelId = (body as any)?.hits?.hits?.[0]?._id ?? null;
  return cachedModelId;
}

// In-process circuit breaker: after an in-engine failure, skip it for a while so a
// blocked Bedrock account doesn't add a failed round-trip to every request.
let inEngineBlockedUntil = 0;

async function generateInEngine(parcel: Record<string, any>): Promise<string | null> {
  if (Date.now() < inEngineBlockedUntil) return null;
  const modelId = await getModelId();
  if (!modelId) return null;
  let body: any;
  try {
    ({ body } = await client.transport.request({
      method: "POST",
      path: `/_plugins/_ml/models/${modelId}/_predict`,
      body: { parameters: { messages: buildWhyMessages(parcel) } },
    }));
  } catch {
    // Call failed outright (e.g. AWS not-authorized/quota): back off, then fall back.
    inEngineBlockedUntil = Date.now() + 5 * 60 * 1000;
    return null;
  }
  const text = parseWhy(body);
  if (!text) {
    // 200 but unparseable. This is the dangerous case: once AWS authorizes, a
    // response-shape mismatch here would silently fall back to OpenAI forever and
    // look "fine". Surface it loudly (and DON'T circuit-break) so it's observable.
    console.warn("[why] in-engine _predict returned but parseWhy was empty; verify shape:", JSON.stringify(body).slice(0, 600));
    return null;
  }
  return text;
}

async function generateOpenAI(parcel: Record<string, any>): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages: buildWhyMessages(parcel), max_tokens: 220, temperature: 0.2 }),
  });
  if (!r.ok) return null;
  return parseOpenAI(await r.json().catch(() => ({}))) || null;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Load the parcel so the summary is grounded only in its indexed fields.
  let parcel: Record<string, any>;
  try {
    const { body } = await client.get({ index: INDEX, id });
    const { description_vector, ...src } = (body._source ?? {}) as Record<string, any>;
    parcel = src;
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Primary: in-engine Lucenia (Bedrock). Fallback: app-side OpenAI.
  const inEngine = await generateInEngine(parcel);
  if (inEngine) return NextResponse.json({ id, summary: inEngine, source: "lucenia-bedrock" });

  const openai = await generateOpenAI(parcel);
  if (openai) return NextResponse.json({ id, summary: openai, source: "openai-fallback" });

  return NextResponse.json(
    { error: "unavailable", detail: "No LLM available: in-engine Bedrock model not authorized and no OPENAI_API_KEY fallback." },
    { status: 503 },
  );
}

// "Why this roof" grounded prompt + response parsing for the in-engine LLM summary.
//
// Generation runs THROUGH Lucenia ml-commons: the API route calls the deployed
// Bedrock model's `_predict` (Lucenia holds the creds + signs the request). We use
// `_predict` rather than the `retrieval_augmented_generation` search processor
// because that processor is non-functional on skylite 0.11.x (async-wiring bug).
// The summary is grounded ONLY in the parcel's own indexed fields.

// Compact, factual one-liner from the parcel's indexed fields. Only include fields
// that are present so we never feed the model a null/undefined.
export function buildWhyFacts(p) {
  const f = [];
  if (p.building_type) f.push(`${p.building_type} building`);
  if (p.roof_type) f.push(`${p.roof_type} roof`);
  if (p.usable_roof_area_sqft != null) f.push(`~${Math.round(p.usable_roof_area_sqft).toLocaleString()} sqft usable roof`);
  if (p.max_panels != null) f.push(`up to ${p.max_panels} panels`);
  if (p.annual_kwh_dc != null) f.push(`~${Math.round(p.annual_kwh_dc / 1000)} MWh/yr potential`);
  if (p.sunshine_kwh_per_kw_yr != null) f.push(`${p.sunshine_kwh_per_kw_yr} kWh/kW-yr sun`);
  if (p.best_azimuth_deg != null) f.push(`${Math.round(p.best_azimuth_deg)}° azimuth`);
  if (p.best_pitch_deg != null) f.push(`${Math.round(p.best_pitch_deg)}° pitch`);
  if (p.roof_age_years != null) f.push(`roof age ${p.roof_age_years} yrs`);
  if (p.owner_occupied != null) f.push(p.owner_occupied ? "owner-occupied" : "leased/tenant-occupied");
  if (p.solar_score != null) f.push(`solar score ${Math.round(p.solar_score)}/100`);
  if (p.est_annual_savings_usd != null) f.push(`est. $${Math.round(p.est_annual_savings_usd).toLocaleString()}/yr savings`);
  if (p.payback_years != null) f.push(`~${p.payback_years} yr payback`);
  if (p.city || p.state) f.push(`${[p.city, p.state].filter(Boolean).join(", ")}`);
  return f.join("; ");
}

// Anthropic Messages payload. The connector supplies anthropic_version/max_tokens/
// temperature; we only pass `messages`. Instructions live in the user turn because
// the connector body doesn't wire a `system` field.
export function buildWhyMessages(p) {
  const facts = buildWhyFacts(p);
  const content =
    "You are a solar sales analyst. Using ONLY the rooftop facts provided, explain in 2-3 sentences " +
    "why this is a strong or weak solar-installation prospect. Be concrete and reference the facts " +
    "(roof size, sun, orientation, age, panels, savings, payback). Do not invent numbers or claims " +
    "beyond the facts. Do not use the word 'roof' more than necessary.\n\n" +
    `Rooftop facts: ${facts}.`;
  return [{ role: "user", content }];
}

// Extract the generated text from a Lucenia `_predict` response (Bedrock Anthropic
// shape: inference_results[].output[].dataAsMap.content[].text). Returns "" if absent.
export function parseWhy(predictResponse) {
  const out = predictResponse?.inference_results?.[0]?.output?.[0]?.dataAsMap;
  if (!out) return "";
  const blocks = out.content;
  if (Array.isArray(blocks)) {
    const text = blocks.map((b) => (b && typeof b.text === "string" ? b.text : "")).join("").trim();
    if (text) return text;
  }
  return "";
}

// Extract text from an OpenAI chat/completions response (app-side fallback path
// used only when the in-engine Bedrock model is unavailable). Returns "" if absent.
export function parseOpenAI(res) {
  const text = res?.choices?.[0]?.message?.content;
  return typeof text === "string" ? text.trim() : "";
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWhyFacts, buildWhyMessages, parseWhy, parseOpenAI } from "../lib/why.mjs";

const parcel = {
  parcel_id: "syn-200",
  building_type: "commercial",
  roof_type: "pitched",
  usable_roof_area_sqft: 8857,
  max_panels: 226,
  annual_kwh_dc: 165367,
  sunshine_kwh_per_kw_yr: 1827,
  best_azimuth_deg: 248,
  best_pitch_deg: 32,
  roof_age_years: 22,
  owner_occupied: false,
  solar_score: 42,
  est_annual_savings_usd: 18190,
  payback_years: 12.4,
  city: "Plano",
  state: "TX",
};

test("buildWhyFacts includes the grounding fields", () => {
  const f = buildWhyFacts(parcel);
  assert.match(f, /commercial building/);
  assert.match(f, /pitched roof/);
  assert.match(f, /8,857 sqft/);
  assert.match(f, /226 panels/);
  assert.match(f, /165 MWh\/yr/);
  assert.match(f, /248° azimuth/);
  assert.match(f, /roof age 22 yrs/);
  assert.match(f, /leased\/tenant-occupied/);
  assert.match(f, /solar score 42\/100/);
  assert.match(f, /Plano, TX/);
});

test("buildWhyFacts omits missing fields (no null/undefined leaks)", () => {
  const f = buildWhyFacts({ building_type: "residential", roof_type: "flat" });
  assert.match(f, /residential building/);
  assert.doesNotMatch(f, /null|undefined|NaN/);
});

test("buildWhyMessages is a single grounded user turn", () => {
  const m = buildWhyMessages(parcel);
  assert.equal(m.length, 1);
  assert.equal(m[0].role, "user");
  assert.match(m[0].content, /ONLY the rooftop facts/);
  assert.match(m[0].content, /8,857 sqft/); // facts embedded
  assert.doesNotMatch(m[0].content, /undefined|null/);
});

test("parseWhy extracts text from the Bedrock Anthropic shape", () => {
  const res = {
    inference_results: [{ output: [{ dataAsMap: { content: [{ type: "text", text: "This roof is a strong prospect." }], stop_reason: "end_turn" } }] }],
  };
  assert.equal(parseWhy(res), "This roof is a strong prospect.");
});

test("parseWhy joins multiple content blocks", () => {
  const res = { inference_results: [{ output: [{ dataAsMap: { content: [{ text: "A " }, { text: "B" }] } }] }] };
  assert.equal(parseWhy(res), "A B");
});

test("parseWhy returns empty string on missing/error shapes", () => {
  assert.equal(parseWhy(undefined), "");
  assert.equal(parseWhy({}), "");
  assert.equal(parseWhy({ inference_results: [{ output: [{ dataAsMap: {} }] }] }), "");
});

test("parseOpenAI extracts the chat completion text", () => {
  const res = { choices: [{ message: { role: "assistant", content: "Strong prospect: big sunny roof." } }] };
  assert.equal(parseOpenAI(res), "Strong prospect: big sunny roof.");
  assert.equal(parseOpenAI({}), "");
  assert.equal(parseOpenAI(undefined), "");
});

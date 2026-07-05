// Unit tests for lib/geohash.mjs — geohash decode (heat rectangles) + score color.
import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeGeohashBounds, scoreColor } from "../lib/geohash.mjs";

test("decodeGeohashBounds brackets the classic 'ezs42' cell (~42.6, -5.6)", () => {
  const b = decodeGeohashBounds("ezs42");
  assert.ok(b.south < 42.605 && b.north > 42.605, `lat ${b.south}..${b.north}`);
  assert.ok(b.west < -5.603 && b.east > -5.603, `lon ${b.west}..${b.east}`);
  assert.ok(b.north > b.south && b.east > b.west, "north>south, east>west");
});

test("decodeGeohashBounds: longer geohash = tighter cell", () => {
  const coarse = decodeGeohashBounds("9v");
  const fine = decodeGeohashBounds("9vg4");
  assert.ok((fine.north - fine.south) < (coarse.north - coarse.south), "finer cell is smaller in lat");
});

test("scoreColor returns an hsl string and clamps out-of-range scores", () => {
  assert.match(scoreColor(50), /^hsl\(38 \d+% \d+%\)$/);
  // clamp: negative and >100 must not throw or produce NaN
  assert.match(scoreColor(-20), /^hsl\(38 \d+% \d+%\)$/);
  assert.match(scoreColor(9999), /^hsl\(38 \d+% \d+%\)$/);
  assert.equal(scoreColor(0), scoreColor(-20), "clamped low end equal");
  assert.equal(scoreColor(100), scoreColor(9999), "clamped high end equal");
});

test("scoreColor: higher score = more saturated + darker", () => {
  const lift = (hsl) => hsl.match(/hsl\(38 (\d+)% (\d+)%\)/).slice(1).map(Number);
  const [sLow, lLow] = lift(scoreColor(10));
  const [sHigh, lHigh] = lift(scoreColor(90));
  assert.ok(sHigh > sLow, "saturation rises with score");
  assert.ok(lHigh < lLow, "lightness falls with score");
});

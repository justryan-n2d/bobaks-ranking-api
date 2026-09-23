import test from "node:test";
import assert from "node:assert/strict";
import { parseCollectorIntervalMinutes } from "../src/utils/collector";

test("defaults collector interval to 10 minutes when omitted", () => {
  assert.equal(parseCollectorIntervalMinutes(undefined), 10);
});

test("enforces the five minute minimum", () => {
  assert.equal(parseCollectorIntervalMinutes("1"), 5);
  assert.equal(parseCollectorIntervalMinutes(5), 5);
});

test("accepts valid collector intervals", () => {
  assert.equal(parseCollectorIntervalMinutes("15"), 15);
});

test("falls back safely for invalid collector intervals", () => {
  for (const value of ["abc", "", "NaN"]) {
    assert.equal(parseCollectorIntervalMinutes(value), 10);
  }
});

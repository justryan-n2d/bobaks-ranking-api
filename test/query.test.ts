import test from "node:test";
import assert from "node:assert/strict";
import { parseHistoryDays } from "../src/utils/query";

test("defaults history days to 7 when omitted", () => {
  assert.equal(parseHistoryDays(undefined), 7);
});

test("accepts an integer from 1 to 365", () => {
  assert.equal(parseHistoryDays("30"), 30);
  assert.equal(parseHistoryDays(365), 365);
});

test("rejects invalid history day values", () => {
  for (const value of ["abc", "0", "366", "1.5", "-7"]) {
    assert.throws(() => parseHistoryDays(value), /Invalid days/);
  }
});

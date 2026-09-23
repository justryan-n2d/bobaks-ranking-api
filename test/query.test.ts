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
  for (const value of ["abc", "NaN", "Infinity", "0", "366", "1.5", "-7", " 1.5 "]) {
    assert.throws(() => parseHistoryDays(value), /Invalid days/);
  }
});

test("rejects a query array with more than one days value", () => {
  assert.throws(() => parseHistoryDays(["7", "30"]), /Invalid days/);
});

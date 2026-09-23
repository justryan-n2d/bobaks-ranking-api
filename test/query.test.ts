import test from "node:test";
import assert from "node:assert/strict";
import { parseHistoryDays } from "../src/utils/query";
import { parseRankingPeriod } from "../src/utils/ranking";

test("defaults history days to 7 when omitted", () => {
  assert.equal(parseHistoryDays(undefined), 7);
});

test("accepts an integer from 1 to 365", () => {
  assert.equal(parseHistoryDays("30"), 30);
  assert.equal(parseHistoryDays(365), 365);
});

test("rejects invalid history day values", () => {
  for (const value of [
    "abc",
    "NaN",
    "Infinity",
    "0",
    "366",
    "1.5",
    "-7",
    " 1.5 ",
    ["7", "30"]
  ]) {
    assert.throws(() => parseHistoryDays(value), /Invalid days/);
  }
});

test("defaults ranking period to live", () => {
  assert.equal(parseRankingPeriod(undefined), "live");
});

test("accepts every supported ranking period", () => {
  assert.equal(parseRankingPeriod("live"), "live");
  assert.equal(parseRankingPeriod("week"), "week");
  assert.equal(parseRankingPeriod("month"), "month");
  assert.equal(parseRankingPeriod("year"), "year");
});

test("rejects invalid ranking periods", () => {
  for (const value of ["weekly", "monthly", "yearly", "day", "abc", ""]) {
    assert.throws(() => parseRankingPeriod(value), /Invalid period/);
  }
});

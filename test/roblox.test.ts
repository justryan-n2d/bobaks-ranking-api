import test from "node:test";
import assert from "node:assert/strict";
import { parsePlayerCount, parseRobloxDate, parseUniverseId } from "../src/utils/roblox";

test("rejects invalid Roblox dates instead of creating Invalid Date", () => {
  assert.equal(parseRobloxDate("not-a-date"), null);
  assert.equal(parseRobloxDate(""), null);
  assert.equal(parseRobloxDate(undefined), null);
  assert.ok(parseRobloxDate("2026-01-01T00:00:00Z") instanceof Date);
});

test("normalizes player counts safely", () => {
  assert.equal(parsePlayerCount("123.4"), 123);
  assert.equal(parsePlayerCount(-5), 0);
  assert.equal(parsePlayerCount("abc"), 0);
});

test("accepts only positive numeric universe IDs", () => {
  assert.equal(parseUniverseId("123"), "123");
  assert.equal(parseUniverseId(456), "456");
  assert.equal(parseUniverseId("0"), null);
  assert.equal(parseUniverseId("abc"), null);
});

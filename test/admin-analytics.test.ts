import assert from "node:assert/strict";
import test from "node:test";
import { buildAnalyticsQueries, parseAnalyticsRange } from "../src/admin-analytics";

function baseUrl(start: string, end: string): URL {
  return new URL("https://bobaks.example/admin/api/analytics?start=" + encodeURIComponent(start) + "&end=" + encodeURIComponent(end));
}

test("admin analytics range parser accepts bounded UTC ranges and selects bucket size", () => {
  const now = new Date("2026-09-30T12:00:00.000Z");
  const hourly = parseAnalyticsRange(
    baseUrl("2026-09-30T00:00:00.000Z", "2026-09-30T12:00:00.000Z"),
    now
  );
  assert.ok(!(hourly instanceof Response));
  assert.equal(hourly.bucketSeconds, 3600);

  const daily = parseAnalyticsRange(
    baseUrl("2026-09-01T00:00:00.000Z", "2026-09-30T00:00:00.000Z"),
    now
  );
  assert.ok(!(daily instanceof Response));
  assert.equal(daily.bucketSeconds, 86400);
});

test("admin analytics range parser rejects malformed, oversized, and future ranges", async () => {
  const now = new Date("2026-09-30T12:00:00.000Z");

  const malformed = parseAnalyticsRange(
    baseUrl("not-a-date", "2026-09-30T12:00:00.000Z"),
    now
  );
  assert.ok(malformed instanceof Response);
  assert.equal(malformed.status, 400);

  const oversized = parseAnalyticsRange(
    baseUrl("2026-07-01T00:00:00.000Z", "2026-09-30T00:00:00.000Z"),
    now
  );
  assert.ok(oversized instanceof Response);
  assert.equal(oversized.status, 400);

  const future = parseAnalyticsRange(
    baseUrl("2026-10-01T00:00:00.000Z", "2026-10-01T01:00:00.000Z"),
    now
  );
  assert.ok(future instanceof Response);
  assert.equal(future.status, 400);
});

test("admin analytics SQL uses exact date bounds and sampling-aware metrics", () => {
  const range = parseAnalyticsRange(
    baseUrl("2026-09-30T00:00:00.000Z", "2026-09-30T12:00:00.000Z"),
    new Date("2026-09-30T12:00:00.000Z")
  );
  assert.ok(!(range instanceof Response));

  const queries = buildAnalyticsQueries(range);
  assert.ok(queries.summary.includes("FROM bobaks_product_web"));
  assert.ok(queries.summary.includes("SUM(_sample_interval * double1)"));
  assert.ok(queries.summary.includes("count(DISTINCT blob6)"));
  assert.ok(queries.summary.includes("count(DISTINCT blob7)"));
  assert.ok(queries.trend.includes("GROUP BY bucket"));
  assert.ok(queries.events.includes("GROUP BY event"));
  assert.ok(queries.routes.includes("blob1 = 'page_view'"));
  assert.ok(queries.games.includes("blob4 AS game_id"));
  assert.ok(queries.returning.includes("GROUP BY visitor_id"));
  assert.ok(!queries.summary.includes("JOIN"));
  assert.ok(!queries.trend.includes("JOIN"));
});

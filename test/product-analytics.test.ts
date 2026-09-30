import assert from "node:assert/strict";
import test from "node:test";

async function loadModule() {
  return import("../scripts/product-analytics-report.mjs");
}

test("product analytics query set uses a bounded lookback and safe dataset name", async () => {
  const { querySet } = await loadModule();
  const queries = querySet(168);

  assert.ok(queries.summary.includes("FROM bobaks_product_web"));
  assert.ok(queries.returning.includes("INTERVAL '888' HOUR"));
  assert.ok(queries.sessions.includes("GROUP BY session_id"));
  assert.ok(queries.summary.includes("count(DISTINCT blob6)"));
  assert.ok(queries.summary.includes("count(DISTINCT blob7)"));
  assert.ok(queries.dailyTrend.includes("toStartOfDay(timestamp)"));
  assert.ok(queries.dailyTrend.includes("GROUP BY day"));
  assert.ok(queries.retentionCohorts.includes("toUnixTimestamp"));
  assert.ok(queries.retentionCohorts.includes("day_offset"));
  assert.ok(queries.retentionCohorts.includes("INTERVAL '888' HOUR"));
  assert.ok(queries.retentionCohorts.includes("first_seen_at"));
  assert.ok(!queries.retentionCohorts.includes(" AS events"));
});

test("product analytics report calculates return rate and preserves sampling notes", async () => {
  const { buildReport } = await loadModule();
  const report = buildReport({
    summary: [{ events: "120", visitors: "20", sessions: "15", max_sample_interval: "1" }],
    sessions: [{ avg_events_per_session: "4.5", max_events_per_session: "13" }],
    returning: [{ active_visitors: "10", returning_visitors: "4" }],
    events: [{ event: "page_view", events: "90", visitors: "20" }],
    routes: [{ route: "/game/:id", views: "50", visitors: "12" }],
    dailyTrend: [
      { day: "2026-09-29 00:00:00", events: "80", visitors: "9", sessions: "7" }
    ],
    retentionCohorts: [
      { cohort_day: "2026-09-24 00:00:00", day_offset: "0", visitors: "10" },
      { cohort_day: "2026-09-24 00:00:00", day_offset: "1", visitors: "6" },
      { cohort_day: "2026-09-24 00:00:00", day_offset: "7", visitors: "4" }
    ]
  }, "2026-09-30T00:00:00.000Z", 168);

  assert.equal(report.windowHours, 168);
  assert.equal(report.metrics.weightedEvents, 120);
  assert.equal(report.metrics.observedVisitors, 20);
  assert.equal(report.metrics.observedSessions, 15);
  assert.equal(report.metrics.averageEventsPerSession, 4.5);
  assert.equal(report.metrics.returningVisitorsInReturnWindow, 4);
  assert.equal(report.metrics.returningVisitorRatePercent, 40);
  assert.equal(report.metrics.maxSampleInterval, 1);
  assert.equal(report.eventBreakdown.length, 1);
  assert.equal(report.pageBreakdown[0].route, "/game/:id");
  assert.equal(report.dailyTrend[0].weightedEvents, 80);
  assert.equal(report.dailyTrend[0].observedVisitors, 9);
  assert.equal(report.retentionCohorts[0].cohortSize, 10);
  assert.equal(report.retentionCohorts[0].days[1].retentionRatePercent, 60);
  assert.equal(report.retentionCohorts[0].days[2].retentionRatePercent, 40);
  assert.ok(report.notes.some(note => note.includes("_sample_interval")));
});

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
  assert.ok(queries.retentionFirstSeen.includes("min(timestamp) AS first_seen_at"));
  assert.ok(queries.retentionFirstSeen.includes("INTERVAL '888' HOUR"));
  assert.ok(queries.retentionFirstSeen.includes("LIMIT ALL"));
  assert.ok(queries.retentionActivity.includes("toStartOfDay(timestamp) AS activity_day"));
  assert.ok(queries.retentionActivity.includes("GROUP BY visitor_id, activity_day"));
  assert.ok(queries.retentionActivity.includes("LIMIT ALL"));
  assert.ok(!queries.retentionActivity.includes("JOIN"));
});

test("product analytics markdown formatter produces a human-readable review artifact", async () => {
  const { formatMarkdownReport } = await loadModule();
  const markdown = formatMarkdownReport({
    generatedAt: "2026-09-30T00:00:00.000Z",
    windowHours: 168,
    dataset: "bobaks_product_web",
    interpretation: {
      trendStatus: "multi_day",
      retentionStatus: "observed_beyond_baseline",
      observedDays: 3,
      oldestObservedDay: "2026-09-28 00:00:00",
      newestObservedDay: "2026-09-30 00:00:00",
      maxObservedRetentionDay: 2,
      retentionMaturity: "emerging"
    },
    metrics: {
      weightedEvents: 120,
      observedVisitors: 20,
      observedSessions: 15,
      averageEventsPerSession: 4.5,
      maxEventsPerSession: 13,
      activeVisitorsInReturnWindow: 10,
      returningVisitorsInReturnWindow: 4,
      returningVisitorRatePercent: 40,
      maxSampleInterval: 2
    },
    dailyTrend: [
      { day: "2026-09-28 00:00:00", weightedEvents: 40, observedVisitors: 8, observedSessions: 6 }
    ],
    retentionCohorts: [
      {
        cohortDay: "2026-09-28",
        cohortSize: 8,
        days: [
          { dayOffset: 0, retentionRatePercent: 100 },
          { dayOffset: 2, retentionRatePercent: 50 }
        ]
      }
    ],
    notes: ["Sampling note"]
  });

  assert.ok(markdown.includes("# Bobaks Product Analytics Report"));
  assert.ok(markdown.includes("Trend status: **multi_day**"));
  assert.ok(markdown.includes("| Returning visitor rate | 40% |"));
  assert.ok(markdown.includes("| 2026-09-28 00:00:00 | 40 | 8 | 6 |"));
  assert.ok(markdown.includes("D2: 50%"));
  assert.ok(markdown.includes("- Sampling note"));
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
    retentionFirstSeen: [
      { visitor_id: "v1", first_seen_at: "2026-09-23 01:00:00" },
      { visitor_id: "v2", first_seen_at: "2026-09-23 02:00:00" },
      { visitor_id: "v3", first_seen_at: "2026-09-23 03:00:00" },
      { visitor_id: "v4", first_seen_at: "2026-09-23 04:00:00" },
      { visitor_id: "v5", first_seen_at: "2026-09-23 05:00:00" },
      { visitor_id: "v6", first_seen_at: "2026-09-23 06:00:00" },
      { visitor_id: "v7", first_seen_at: "2026-09-23 07:00:00" },
      { visitor_id: "v8", first_seen_at: "2026-09-23 08:00:00" },
      { visitor_id: "v9", first_seen_at: "2026-09-23 09:00:00" },
      { visitor_id: "v10", first_seen_at: "2026-09-23 10:00:00" }
    ],
    retentionActivity: [
      { visitor_id: "v1", activity_day: "2026-09-23 00:00:00" },
      { visitor_id: "v2", activity_day: "2026-09-23 00:00:00" },
      { visitor_id: "v3", activity_day: "2026-09-23 00:00:00" },
      { visitor_id: "v4", activity_day: "2026-09-23 00:00:00" },
      { visitor_id: "v5", activity_day: "2026-09-23 00:00:00" },
      { visitor_id: "v6", activity_day: "2026-09-23 00:00:00" },
      { visitor_id: "v7", activity_day: "2026-09-23 00:00:00" },
      { visitor_id: "v8", activity_day: "2026-09-23 00:00:00" },
      { visitor_id: "v9", activity_day: "2026-09-23 00:00:00" },
      { visitor_id: "v10", activity_day: "2026-09-23 00:00:00" },
      { visitor_id: "v1", activity_day: "2026-09-24 00:00:00" },
      { visitor_id: "v2", activity_day: "2026-09-24 00:00:00" },
      { visitor_id: "v3", activity_day: "2026-09-24 00:00:00" },
      { visitor_id: "v4", activity_day: "2026-09-24 00:00:00" },
      { visitor_id: "v5", activity_day: "2026-09-24 00:00:00" },
      { visitor_id: "v6", activity_day: "2026-09-24 00:00:00" },
      { visitor_id: "v1", activity_day: "2026-09-30 00:00:00" },
      { visitor_id: "v2", activity_day: "2026-09-30 00:00:00" },
      { visitor_id: "v3", activity_day: "2026-09-30 00:00:00" },
      { visitor_id: "v4", activity_day: "2026-09-30 00:00:00" }
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
  assert.equal(report.interpretation.trendStatus, "single_day");
  assert.equal(report.interpretation.retentionStatus, "observed_beyond_baseline");
  assert.equal(report.interpretation.observedDays, 1);
  assert.equal(report.interpretation.oldestObservedDay, "2026-09-29 00:00:00");
  assert.equal(report.interpretation.newestObservedDay, "2026-09-29 00:00:00");
  assert.equal(report.interpretation.maxObservedRetentionDay, 7);
  assert.equal(report.interpretation.retentionMaturity, "7_day");
  assert.equal(report.eventBreakdown.length, 1);
  assert.equal(report.pageBreakdown[0].route, "/game/:id");
  assert.equal(report.dailyTrend[0].weightedEvents, 80);
  assert.equal(report.dailyTrend[0].observedVisitors, 9);
  assert.equal(report.retentionCohorts[0].cohortSize, 10);
  assert.equal(report.retentionCohorts[0].days[1].retentionRatePercent, 60);
  assert.equal(report.retentionCohorts[0].days[2].retentionRatePercent, 40);
  assert.ok(report.notes.some(note => note.includes("_sample_interval")));
});

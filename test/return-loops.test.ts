import assert from "node:assert/strict";
import test from "node:test";
import {
  computeHistoricalMilestones,
  detectReturnAlerts,
  detectNewPeak
} from "../frontend/return-loops-core.mjs";

test("historical milestones identify first recording, best rank, and first top-10 date", () => {
  const result = computeHistoricalMilestones(
    [
      { timestamp: "2026-09-20T00:00:00.000Z", playerCount: 120 },
      { timestamp: "2026-09-21T00:00:00.000Z", playerCount: 850 },
      { timestamp: "2026-09-22T00:00:00.000Z", playerCount: 650 }
    ],
    [
      { date: "2026-09-20", rank: 42 },
      { date: "2026-09-21", rank: 8 },
      { date: "2026-09-22", rank: 12 }
    ],
    { peakPlayers: 850, peakAt: "2026-09-21T12:00:00.000Z" }
  );

  assert.deepEqual(result, {
    firstRecordedAt: "2026-09-20",
    bestRank: 8,
    bestRankAt: "2026-09-21",
    firstTop10At: "2026-09-21",
    peakPlayers: 850,
    peakAt: "2026-09-21T12:00:00.000Z",
    historicalDays: 3
  });
});

test("return alerts fire when a saved game enters top 10 or sets a new peak", () => {
  const alerts = detectReturnAlerts({
    previous: { rank: 16, peakPlayers: 500, peakAt: "2026-09-20T00:00:00.000Z" },
    current: { rank: 9, peakPlayers: 650, peakAt: "2026-09-21T00:00:00.000Z" },
    preferences: { top10: true, newPeak: true, bigMove: true }
  });

  assert.deepEqual(alerts.map(alert => alert.type), ["top10", "newPeak", "bigMove"]);
});

test("return alerts do not repeat a peak that has already been observed", () => {
  const alerts = detectReturnAlerts({
    previous: { rank: 8, peakPlayers: 650, peakAt: "2026-09-21T00:00:00.000Z" },
    current: { rank: 7, peakPlayers: 650, peakAt: "2026-09-21T00:00:00.000Z" },
    preferences: { top10: true, newPeak: true, bigMove: true }
  });

  assert.equal(alerts.some(alert => alert.type === "newPeak"), false);
  assert.equal(alerts.some(alert => alert.type === "top10"), false);
});

test("new peak detection ignores a first-time baseline", () => {
  assert.equal(detectNewPeak(null, { peakPlayers: 900, peakAt: "2026-09-30T00:00:00.000Z" }), false);
  assert.equal(
    detectNewPeak(
      { peakPlayers: 850, peakAt: "2026-09-29T00:00:00.000Z" },
      { peakPlayers: 900, peakAt: "2026-09-30T00:00:00.000Z" }
    ),
    true
  );
});


test("stale home decorations are rejected after ranking navigation", async () => {
  const core = await import("../frontend/return-loops-core.mjs");
  assert.equal(typeof core.isCurrentHomeDecoration, "function");

  const oldDashboard = {};
  const newDashboard = {};
  assert.equal(
    core.isCurrentHomeDecoration({
      capturedHost: oldDashboard,
      currentHost: newDashboard,
      capturedPath: "/rankings/weekly",
      currentPath: "/"
    }),
    false
  );
  assert.equal(
    core.isCurrentHomeDecoration({
      capturedHost: newDashboard,
      currentHost: newDashboard,
      capturedPath: "/",
      currentPath: "/"
    }),
    true
  );
  assert.equal(
    core.isCurrentHomeDecoration({
      capturedHost: newDashboard,
      currentHost: newDashboard,
      capturedPath: "/rankings/weekly",
      currentPath: "/"
    }),
    false
  );
});

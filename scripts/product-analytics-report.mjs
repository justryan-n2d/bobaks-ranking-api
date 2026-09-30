import fs from "node:fs/promises";

const DATASET = process.env.BOBAKS_ANALYTICS_DATASET || "bobaks_product_web";
const ACCOUNT_ID = String(process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
const API_TOKEN = String(process.env.CLOUDFLARE_ANALYTICS_API_TOKEN || "").trim();
const HOURS = parseHours(process.env.ANALYTICS_REPORT_HOURS || "168");
const OUTPUT_FILE = String(process.env.ANALYTICS_OUTPUT_FILE || "product-analytics-report.json").trim();
const MARKDOWN_OUTPUT_FILE = String(process.env.ANALYTICS_MARKDOWN_OUTPUT_FILE || "product-analytics-report.md").trim();

function parseHours(value) {
  const hours = Number(value);
  if (!Number.isInteger(hours) || hours < 1 || hours > 168) {
    throw new Error("ANALYTICS_REPORT_HOURS must be an integer from 1 to 168.");
  }
  return hours;
}

function safeIdentifier(value, label) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(label + " contains an invalid SQL identifier.");
  }
  return value;
}

const TABLE = safeIdentifier(DATASET, "BOBAKS_ANALYTICS_DATASET");

export function querySet(hours) {
  const lookbackHours = hours + (30 * 24);
  return {
    summary:
      "SELECT SUM(_sample_interval * double1) AS events, " +
      "count(DISTINCT blob6) AS visitors, " +
      "count(DISTINCT blob7) AS sessions, " +
      "max(_sample_interval) AS max_sample_interval " +
      "FROM " + TABLE +
      " WHERE timestamp >= NOW() - INTERVAL '" + hours + "' HOUR " +
      "AND blob6 != ''",
    events:
      "SELECT blob1 AS event, " +
      "SUM(_sample_interval * double1) AS events, " +
      "count(DISTINCT blob6) AS visitors " +
      "FROM " + TABLE +
      " WHERE timestamp >= NOW() - INTERVAL '" + hours + "' HOUR " +
      "AND blob6 != '' GROUP BY event ORDER BY events DESC LIMIT 50",
    routes:
      "SELECT blob2 AS route, " +
      "SUM(_sample_interval * double1) AS views, " +
      "count(DISTINCT blob6) AS visitors " +
      "FROM " + TABLE +
      " WHERE timestamp >= NOW() - INTERVAL '" + hours + "' HOUR " +
      "AND blob6 != '' AND blob1 = 'page_view' GROUP BY route ORDER BY views DESC LIMIT 50",
    sessions:
      "SELECT count() AS sessions, " +
      "avg(event_count) AS avg_events_per_session, " +
      "max(event_count) AS max_events_per_session " +
      "FROM (SELECT blob7 AS session_id, " +
      "SUM(_sample_interval * double1) AS event_count " +
      "FROM " + TABLE +
      " WHERE timestamp >= NOW() - INTERVAL '" + hours + "' HOUR " +
      "AND blob6 != '' AND blob7 != '' GROUP BY session_id)",
    dailyTrend:
      "SELECT toStartOfDay(timestamp) AS day, " +
      "SUM(_sample_interval * double1) AS events, " +
      "count(DISTINCT blob6) AS visitors, " +
      "count(DISTINCT blob7) AS sessions " +
      "FROM " + TABLE +
      " WHERE timestamp >= NOW() - INTERVAL '" + hours + "' HOUR " +
      "AND blob6 != '' GROUP BY day ORDER BY day ASC",
    retentionFirstSeen:
      "SELECT blob6 AS visitor_id, min(timestamp) AS first_seen_at " +
      "FROM " + TABLE +
      " WHERE timestamp >= NOW() - INTERVAL '" + lookbackHours + "' HOUR " +
      "AND blob6 != '' GROUP BY visitor_id LIMIT ALL",
    retentionActivity:
      "SELECT blob6 AS visitor_id, toStartOfDay(timestamp) AS activity_day " +
      "FROM " + TABLE +
      " WHERE timestamp >= NOW() - INTERVAL '" + hours + "' HOUR " +
      "AND blob6 != '' GROUP BY visitor_id, activity_day LIMIT ALL",
    returning:
      "SELECT " +
      "countIf(last_seen >= NOW() - INTERVAL '" + hours + "' HOUR) AS active_visitors, " +
      "countIf(first_seen < NOW() - INTERVAL '" + hours + "' HOUR " +
      "AND last_seen >= NOW() - INTERVAL '" + hours + "' HOUR) AS returning_visitors " +
      "FROM (SELECT blob6 AS visitor_id, min(timestamp) AS first_seen, " +
      "max(timestamp) AS last_seen FROM " + TABLE +
      " WHERE timestamp >= NOW() - INTERVAL '" + lookbackHours + "' HOUR " +
      "AND blob6 != '' GROUP BY visitor_id)"
  };
}

async function runSql(sql) {
  const endpoint =
    "https://api.cloudflare.com/client/v4/accounts/" +
    encodeURIComponent(ACCOUNT_ID) +
    "/analytics_engine/sql";

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + API_TOKEN,
      "content-type": "text/plain; charset=utf-8"
    },
    body: sql + " FORMAT JSON"
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      "Cloudflare Analytics Engine query failed (" +
      response.status + "): " + detail.slice(0, 500)
    );
  }

  const body = await response.json();
  return Array.isArray(body.data) ? body.data : [];
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function buildReport(rows, generatedAt = new Date().toISOString(), hours = HOURS) {
  const summary = rows.summary?.[0] || {};
  const session = rows.sessions?.[0] || {};
  const returning = rows.returning?.[0] || {};
  const dailyTrend = (rows.dailyTrend || []).map(row => ({
    day: row.day,
    weightedEvents: numberOrZero(row.events),
    observedVisitors: numberOrZero(row.visitors),
    observedSessions: numberOrZero(row.sessions)
  }));
  const reportEnd = new Date(generatedAt).getTime();
  const reportWindowStart = reportEnd - (hours * 60 * 60 * 1000);
  const firstSeenByVisitor = new Map();
  for (const row of rows.retentionFirstSeen || []) {
    const visitorId = String(row.visitor_id || "");
    const firstSeenAt = new Date(String(row.first_seen_at || "")).getTime();
    if (!visitorId || !Number.isFinite(firstSeenAt)) continue;
    if (firstSeenAt >= reportWindowStart) {
      firstSeenByVisitor.set(visitorId, new Date(firstSeenAt));
    }
  }
  const cohortVisitors = new Map();
  for (const [visitorId, firstSeenAt] of firstSeenByVisitor) {
    const cohortDay = firstSeenAt.toISOString().slice(0, 10);
    if (!cohortVisitors.has(cohortDay)) cohortVisitors.set(cohortDay, new Map());
    cohortVisitors.get(cohortDay).set(visitorId, new Set([0]));
  }
  for (const row of rows.retentionActivity || []) {
    const visitorId = String(row.visitor_id || "");
    const firstSeenAt = firstSeenByVisitor.get(visitorId);
    if (!firstSeenAt) continue;
    const activityDay = new Date(String(row.activity_day || "")).getTime();
    if (!Number.isFinite(activityDay)) continue;
    const cohortDay = firstSeenAt.toISOString().slice(0, 10);
    const dayOffset = Math.floor((activityDay - Date.UTC(
      firstSeenAt.getUTCFullYear(),
      firstSeenAt.getUTCMonth(),
      firstSeenAt.getUTCDate()
    )) / 86400000);
    if (dayOffset < 0 || dayOffset > 7) continue;
    if (!cohortVisitors.has(cohortDay)) cohortVisitors.set(cohortDay, new Map());
    if (!cohortVisitors.get(cohortDay).has(visitorId)) {
      cohortVisitors.get(cohortDay).set(visitorId, new Set());
    }
    cohortVisitors.get(cohortDay).get(visitorId).add(dayOffset);
  }
  const cohortCounts = new Map();
  for (const [cohortDay, visitors] of cohortVisitors) {
    const dayCounts = new Map();
    for (const offsets of visitors.values()) {
      for (const dayOffset of offsets) {
        dayCounts.set(dayOffset, (dayCounts.get(dayOffset) || 0) + 1);
      }
    }
    cohortCounts.set(cohortDay, dayCounts);
  }
  const retentionCohorts = [...cohortCounts.entries()].map(([cohortDay, dayCounts]) => {
    const cohortSize = dayCounts.get(0) || 0;
    const days = [...dayCounts.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([dayOffset, observedVisitors]) => ({
        dayOffset,
        observedVisitors,
        retentionRatePercent: cohortSize > 0
          ? Number(((observedVisitors / cohortSize) * 100).toFixed(2))
          : 0
      }));
    return { cohortDay, cohortSize, days };
  });
  const activeVisitors = numberOrZero(returning.active_visitors);
  const returningVisitors = numberOrZero(returning.returning_visitors);
  const observedDays = dailyTrend.length;
  const hasMultiDayTrend = observedDays >= 2;
  const maxObservedRetentionDay = retentionCohorts.reduce(
    (max, cohort) => Math.max(max, ...cohort.days.map(day => day.dayOffset)),
    0
  );
  const hasObservedRetentionBeyondBaseline = maxObservedRetentionDay > 0;

  return {
    generatedAt,
    windowHours: hours,
    dataset: DATASET,
    interpretation: {
      trendStatus: hasMultiDayTrend ? "multi_day" : "single_day",
      retentionStatus: hasObservedRetentionBeyondBaseline ? "observed_beyond_baseline" : "baseline_only",
      observedDays,
      oldestObservedDay: dailyTrend[0]?.day || null,
      newestObservedDay: dailyTrend[dailyTrend.length - 1]?.day || null,
      maxObservedRetentionDay,
      retentionMaturity:
        maxObservedRetentionDay >= 7
          ? "7_day"
          : maxObservedRetentionDay > 0
            ? "emerging"
            : "baseline_only",
    },
    metrics: {
      weightedEvents: numberOrZero(summary.events),
      observedVisitors: numberOrZero(summary.visitors),
      observedSessions: numberOrZero(summary.sessions),
      averageEventsPerSession: numberOrZero(session.avg_events_per_session),
      maxEventsPerSession: numberOrZero(session.max_events_per_session),
      activeVisitorsInReturnWindow: activeVisitors,
      returningVisitorsInReturnWindow: returningVisitors,
      returningVisitorRatePercent: activeVisitors > 0
        ? Number(((returningVisitors / activeVisitors) * 100).toFixed(2))
        : 0,
      maxSampleInterval: numberOrZero(summary.max_sample_interval)
    },
    eventBreakdown: rows.events || [],
    pageBreakdown: rows.routes || [],
    dailyTrend,
    retentionCohorts,
    notes: [
      "Weighted event totals use _sample_interval so event counts remain statistically correct when Analytics Engine sampling occurs.",
      "Visitor and session counts, including retention cohorts, are observed distinct identifiers and can be affected by Analytics Engine sampling.",
      "Returning visitor rate uses a 30-day lookback before the selected report window.",
      "Retention cohorts use each visitor's first observed timestamp from the 30-day lookback, with cohorts constrained to the selected report window, and report observed return rates through day 7 where data exists.",
      "A day-0 retention value is the cohort baseline and should not be interpreted as repeat retention.",
      "A single observed day is a snapshot, not a multi-day trend.",
      "Visitor identifiers are random first-party identifiers, expire after 30 days, and are not linked to Roblox account identities."
    ]
  };
}

function markdownCell(value) {
  return String(value ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("\\r", "")
    .replaceAll("\\n", " ");
}

export function formatMarkdownReport(report) {
  const interpretation = report.interpretation || {};
  const metrics = report.metrics || {};
  const lines = [
    "# Bobaks Product Analytics Report",
    "",
    `Generated: ${markdownCell(report.generatedAt)}`,
    `Window: ${markdownCell(report.windowHours)} hours`,
    `Dataset: ${markdownCell(report.dataset)}`,
    "",
    "## Data readiness",
    "",
    `- Trend status: **${markdownCell(interpretation.trendStatus || "unknown")}**`,
    `- Retention status: **${markdownCell(interpretation.retentionStatus || "unknown")}**`,
    `- Observed days: **${markdownCell(interpretation.observedDays ?? 0)}**`,
    `- Retention maturity: **${markdownCell(interpretation.retentionMaturity || "unknown")}**`,
    `- Max observed retention day: **${markdownCell(interpretation.maxObservedRetentionDay ?? 0)}**`,
    `- Observed period: ${markdownCell(interpretation.oldestObservedDay || "n/a")} to ${markdownCell(interpretation.newestObservedDay || "n/a")}`,
    "",
    "## Key metrics",
    "",
    "| Metric | Value |",
    "| --- | ---: |",
    `| Weighted events | ${markdownCell(metrics.weightedEvents ?? 0)} |`,
    `| Observed visitors | ${markdownCell(metrics.observedVisitors ?? 0)} |`,
    `| Observed sessions | ${markdownCell(metrics.observedSessions ?? 0)} |`,
    `| Average events/session | ${markdownCell(metrics.averageEventsPerSession ?? 0)} |`,
    `| Max events/session | ${markdownCell(metrics.maxEventsPerSession ?? 0)} |`,
    `| Active visitors in return window | ${markdownCell(metrics.activeVisitorsInReturnWindow ?? 0)} |`,
    `| Returning visitors in return window | ${markdownCell(metrics.returningVisitorsInReturnWindow ?? 0)} |`,
    `| Returning visitor rate | ${markdownCell(metrics.returningVisitorRatePercent ?? 0)}% |`,
    `| Max sample interval | ${markdownCell(metrics.maxSampleInterval ?? 0)} |`,
    "",
    "## Daily trend",
    "",
    "| Day | Weighted events | Visitors | Sessions |",
    "| --- | ---: | ---: | ---: |"
  ];

  if ((report.dailyTrend || []).length === 0) {
    lines.push("| No observed days | 0 | 0 | 0 |");
  } else {
    for (const row of report.dailyTrend) {
      lines.push(
        `| ${markdownCell(row.day)} | ${markdownCell(row.weightedEvents)} | ${markdownCell(row.observedVisitors)} | ${markdownCell(row.observedSessions)} |`
      );
    }
  }

  lines.push("", "## Retention cohorts", "", "| Cohort day | Size | Retention by observed day |", "| --- | ---: | --- |");
  if ((report.retentionCohorts || []).length === 0) {
    lines.push("| No cohorts observed | 0 | n/a |");
  } else {
    for (const cohort of report.retentionCohorts) {
      const retention = (cohort.days || [])
        .map(day => `D${day.dayOffset}: ${day.retentionRatePercent}%`)
        .join(", ");
      lines.push(`| ${markdownCell(cohort.cohortDay)} | ${markdownCell(cohort.cohortSize)} | ${markdownCell(retention)} |`);
    }
  }

  lines.push("", "## Notes", "");
  for (const note of report.notes || []) {
    lines.push(`- ${markdownCell(note)}`);
  }
  lines.push("");

  return lines.join("\\n");
}

export async function generateReport() {
  if (!ACCOUNT_ID || !API_TOKEN) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_ANALYTICS_API_TOKEN are required.");
  }

  const queries = querySet(HOURS);
  const resultRows = {};
  for (const [name, sql] of Object.entries(queries)) {
    resultRows[name] = await runSql(sql);
  }

  const report = buildReport(resultRows, new Date().toISOString(), HOURS);
  await fs.writeFile(OUTPUT_FILE, JSON.stringify(report, null, 2) + "\n", "utf8");
  await fs.writeFile(MARKDOWN_OUTPUT_FILE, formatMarkdownReport(report) + "\n", "utf8");
  return report;
}

if (process.argv[1]?.endsWith("/product-analytics-report.mjs")) {
  generateReport()
    .then(report => process.stdout.write(JSON.stringify(report, null, 2) + "\n"))
    .catch(error => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}

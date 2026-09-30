import fs from "node:fs/promises";

const DATASET = process.env.BOBAKS_ANALYTICS_DATASET || "bobaks_product_web";
const ACCOUNT_ID = String(process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
const API_TOKEN = String(process.env.CLOUDFLARE_ANALYTICS_API_TOKEN || "").trim();
const HOURS = parseHours(process.env.ANALYTICS_REPORT_HOURS || "168");
const OUTPUT_FILE = String(process.env.ANALYTICS_OUTPUT_FILE || "product-analytics-report.json").trim();

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
    retentionCohorts:
      "WITH first_seen AS (" +
      "SELECT blob6 AS visitor_id, min(timestamp) AS first_seen_at, " +
      "toStartOfDay(min(timestamp)) AS cohort_day " +
      "FROM " + TABLE +
      " WHERE timestamp >= NOW() - INTERVAL '" + lookbackHours + "' HOUR " +
      "AND blob6 != '' GROUP BY visitor_id) " +
      "SELECT first_seen.cohort_day AS cohort_day, " +
      "intDiv(toUnixTimestamp(toStartOfDay(events.timestamp)) - " +
      "toUnixTimestamp(first_seen.cohort_day), 86400) AS day_offset, " +
      "count(DISTINCT events.blob6) AS visitors " +
      "FROM " + TABLE + " AS events " +
      "INNER JOIN first_seen ON events.blob6 = first_seen.visitor_id " +
      "WHERE events.timestamp >= NOW() - INTERVAL '" + hours + "' HOUR " +
      "AND first_seen.first_seen_at >= NOW() - INTERVAL '" + hours + "' HOUR " +
      "AND events.blob6 != '' " +
      "GROUP BY cohort_day, day_offset " +
      "HAVING day_offset BETWEEN 0 AND 7 " +
      "ORDER BY cohort_day ASC, day_offset ASC LIMIT 500",
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
  const cohortGroups = new Map();
  for (const row of rows.retentionCohorts || []) {
    const cohortDay = String(row.cohort_day || "");
    if (!cohortDay) continue;
    if (!cohortGroups.has(cohortDay)) cohortGroups.set(cohortDay, []);
    cohortGroups.get(cohortDay).push({
      dayOffset: numberOrZero(row.day_offset),
      observedVisitors: numberOrZero(row.visitors)
    });
  }
  const retentionCohorts = [...cohortGroups.entries()].map(([cohortDay, points]) => {
    const dayZero = points.find(point => point.dayOffset === 0);
    const cohortSize = dayZero?.observedVisitors || 0;
    return {
      cohortDay,
      cohortSize,
      days: points.map(point => ({
        dayOffset: point.dayOffset,
        observedVisitors: point.observedVisitors,
        retentionRatePercent: cohortSize > 0
          ? Number(((point.observedVisitors / cohortSize) * 100).toFixed(2))
          : 0
      }))
    };
  });
  const activeVisitors = numberOrZero(returning.active_visitors);
  const returningVisitors = numberOrZero(returning.returning_visitors);

  return {
    generatedAt,
    windowHours: hours,
    dataset: DATASET,
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
      "Visitor identifiers are random first-party identifiers, expire after 30 days, and are not linked to Roblox account identities."
    ]
  };
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

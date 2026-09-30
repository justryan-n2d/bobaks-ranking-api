import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

export interface AdminAnalyticsEnv {
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_ANALYTICS_API_TOKEN?: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
}

export interface AnalyticsRange {
  start: Date;
  end: Date;
  bucketSeconds: number;
}

type FetchLike = typeof fetch;

const DATASET = "bobaks_product_web";
const MAX_RANGE_MS = 31 * 24 * 60 * 60 * 1000;
const FUTURE_SKEW_MS = 5 * 60 * 1000;
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getTeamDomain(env: AdminAnalyticsEnv): string | null {
  const value = String(env.CF_ACCESS_TEAM_DOMAIN ?? "").trim().replace(/\/$/, "");
  if (!value) return null;

  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash) {
      return null;
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function getJwks(teamDomain: string): ReturnType<typeof createRemoteJWKSet> {
  const existing = jwksCache.get(teamDomain);
  if (existing) return existing;

  const jwks = createRemoteJWKSet(
    new URL(teamDomain + "/cdn-cgi/access/certs")
  );
  jwksCache.set(teamDomain, jwks);
  return jwks;
}

export async function authorizeAdminAnalytics(
  request: Request,
  env: AdminAnalyticsEnv
): Promise<{ email: string; payload: JWTPayload } | Response> {
  const teamDomain = getTeamDomain(env);
  const audience = String(env.CF_ACCESS_AUD ?? "").trim();

  if (!teamDomain || !audience) {
    return new Response("Private analytics access is not configured.", {
      status: 503,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store"
      }
    });
  }

  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) {
    return new Response("Authentication required.", {
      status: 401,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
        "www-authenticate": "Bearer"
      }
    });
  }

  try {
    const { payload } = await jwtVerify(token, getJwks(teamDomain), {
      issuer: teamDomain,
      audience
    });

    const email = String(payload.email ?? "").trim().toLowerCase();
    if (!email) {
      return new Response("Authenticated identity is missing an email address.", {
        status: 403,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store"
        }
      });
    }

    // The Cloudflare Access application policy is the owner/admin allowlist.
    // The Worker validates the Access JWT signature, issuer, and audience so
    // direct requests cannot bypass Access with a forged header.
    return { email, payload };
  } catch {
    return new Response("Access token is invalid or expired.", {
      status: 403,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store"
      }
    });
  }
}

function isIsoTimestamp(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) {
    return false;
  }
  return Number.isFinite(Date.parse(value));
}

function toSqlTimestamp(value: Date): string {
  return value.toISOString().slice(0, 19).replace("T", " ");
}

function shiftMilliseconds(value: Date, deltaMs: number): Date {
  return new Date(value.getTime() + deltaMs);
}

export function parseAnalyticsRange(
  url: URL,
  now = new Date()
): AnalyticsRange | Response {
  const startValue = String(url.searchParams.get("start") ?? "").trim();
  const endValue = String(url.searchParams.get("end") ?? "").trim();

  if (!isIsoTimestamp(startValue) || !isIsoTimestamp(endValue)) {
    return new Response("start and end must be UTC ISO timestamps.", {
      status: 400,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }
    });
  }

  const start = new Date(startValue);
  const end = new Date(endValue);
  const rangeMs = end.getTime() - start.getTime();

  if (!Number.isFinite(rangeMs) || rangeMs <= 0 || rangeMs > MAX_RANGE_MS) {
    return new Response("Analytics date range must be between 1 millisecond and 31 days.", {
      status: 400,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }
    });
  }

  if (start.getTime() > now.getTime() + FUTURE_SKEW_MS) {
    return new Response("Analytics start cannot be in the future.", {
      status: 400,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }
    });
  }

  const bucketSeconds = rangeMs <= 2 * 24 * 60 * 60 * 1000 ? 3600 : 86400;

  return { start, end, bucketSeconds };
}

export function buildAnalyticsQueries(range: AnalyticsRange): Record<string, string> {
  const start = toSqlTimestamp(range.start);
  const end = toSqlTimestamp(range.end);
  const previousStart = toSqlTimestamp(shiftMilliseconds(range.start, -(range.end.getTime() - range.start.getTime())));
  const previousEnd = start;
  const lookbackStart = toSqlTimestamp(shiftMilliseconds(range.start, -30 * 24 * 60 * 60 * 1000));
  const bucket = range.bucketSeconds;

  return {
    summary:
      "SELECT " +
      "SUM(_sample_interval * double1) AS events, " +
      "SUMIf(_sample_interval * double1, blob1 = 'page_view') AS page_views, " +
      "count(DISTINCT blob6) AS visitors, " +
      "count(DISTINCT blob7) AS sessions, " +
      "max(_sample_interval) AS max_sample_interval " +
      "FROM " + DATASET +
      " WHERE timestamp >= '" + start + "' AND timestamp < '" + end + "'" +
      " AND blob6 != ''",

    previousSummary:
      "SELECT " +
      "SUM(_sample_interval * double1) AS events, " +
      "SUMIf(_sample_interval * double1, blob1 = 'page_view') AS page_views, " +
      "count(DISTINCT blob6) AS visitors, " +
      "count(DISTINCT blob7) AS sessions, " +
      "max(_sample_interval) AS max_sample_interval " +
      "FROM " + DATASET +
      " WHERE timestamp >= '" + previousStart + "' AND timestamp < '" + previousEnd + "'" +
      " AND blob6 != ''",

    returning:
      "SELECT " +
      "countIf(last_seen >= '" + start + "' AND last_seen < '" + end + "') AS active_visitors, " +
      "countIf(first_seen < '" + start + "' AND last_seen >= '" + start + "' AND last_seen < '" + end + "') AS returning_visitors " +
      "FROM (SELECT blob6 AS visitor_id, min(timestamp) AS first_seen, max(timestamp) AS last_seen " +
      "FROM " + DATASET +
      " WHERE timestamp >= '" + lookbackStart + "' AND timestamp < '" + end + "'" +
      " AND blob6 != '' GROUP BY visitor_id LIMIT ALL)",

    trend:
      "SELECT intDiv(toUInt32(timestamp), " + bucket + ") * " + bucket + " AS bucket, " +
      "SUM(_sample_interval * double1) AS events, " +
      "SUMIf(_sample_interval * double1, blob1 = 'page_view') AS page_views, " +
      "count(DISTINCT blob6) AS visitors, " +
      "count(DISTINCT blob7) AS sessions " +
      "FROM " + DATASET +
      " WHERE timestamp >= '" + start + "' AND timestamp < '" + end + "'" +
      " AND blob6 != '' GROUP BY bucket ORDER BY bucket ASC LIMIT ALL",

    events:
      "SELECT blob1 AS event, " +
      "SUM(_sample_interval * double1) AS events, " +
      "count(DISTINCT blob6) AS visitors " +
      "FROM " + DATASET +
      " WHERE timestamp >= '" + start + "' AND timestamp < '" + end + "'" +
      " AND blob6 != '' GROUP BY event ORDER BY events DESC LIMIT 50",

    routes:
      "SELECT blob2 AS route, " +
      "SUM(_sample_interval * double1) AS views, " +
      "count(DISTINCT blob6) AS visitors " +
      "FROM " + DATASET +
      " WHERE timestamp >= '" + start + "' AND timestamp < '" + end + "'" +
      " AND blob6 != '' AND blob1 = 'page_view' GROUP BY route ORDER BY views DESC LIMIT 50",

    games:
      "SELECT blob4 AS game_id, " +
      "SUM(_sample_interval * double1) AS views, " +
      "count(DISTINCT blob6) AS visitors " +
      "FROM " + DATASET +
      " WHERE timestamp >= '" + start + "' AND timestamp < '" + end + "'" +
      " AND blob6 != '' AND blob1 = 'page_view' AND blob4 != ''" +
      " GROUP BY game_id ORDER BY views DESC LIMIT 20"
  };
}

async function runSql(
  sql: string,
  env: AdminAnalyticsEnv,
  fetchImpl: FetchLike = fetch
): Promise<Array<Record<string, unknown>>> {
  const accountId = String(env.CLOUDFLARE_ACCOUNT_ID ?? "").trim();
  const token = String(env.CLOUDFLARE_ANALYTICS_API_TOKEN ?? "").trim();

  if (!accountId || !token) {
    throw new Error("Cloudflare Analytics Engine credentials are not configured.");
  }

  const endpoint =
    "https://api.cloudflare.com/client/v4/accounts/" +
    encodeURIComponent(accountId) +
    "/analytics_engine/sql";

  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "content-type": "text/plain; charset=utf-8"
    },
    body: sql + " FORMAT JSON"
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      "Cloudflare Analytics Engine query failed (" +
      response.status +
      "): " +
      detail.slice(0, 300)
    );
  }

  const body = await response.json() as { data?: Array<Record<string, unknown>> };
  return Array.isArray(body.data) ? body.data : [];
}

function numberOrZero(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Number((((current - previous) / previous) * 100).toFixed(2));
}

export async function fetchAdminAnalytics(
  range: AnalyticsRange,
  env: AdminAnalyticsEnv,
  fetchImpl: FetchLike = fetch
): Promise<Record<string, unknown>> {
  const queries = buildAnalyticsQueries(range);
  const names = Object.keys(queries);
  const rows = await Promise.all(
    names.map(async name => [name, await runSql(queries[name], env, fetchImpl)] as const)
  );
  const result = Object.fromEntries(rows);

  const current = result.summary?.[0] ?? {};
  const previous = result.previousSummary?.[0] ?? {};
  const returning = result.returning?.[0] ?? {};

  const summary = {
    weightedEvents: numberOrZero(current.events),
    pageViews: numberOrZero(current.page_views),
    observedVisitors: numberOrZero(current.visitors),
    observedSessions: numberOrZero(current.sessions),
    maxSampleInterval: numberOrZero(current.max_sample_interval),
    activeVisitors: numberOrZero(returning.active_visitors),
    returningVisitors: numberOrZero(returning.returning_visitors)
  };

  const previousSummary = {
    weightedEvents: numberOrZero(previous.events),
    pageViews: numberOrZero(previous.page_views),
    observedVisitors: numberOrZero(previous.visitors),
    observedSessions: numberOrZero(previous.sessions),
    maxSampleInterval: numberOrZero(previous.max_sample_interval)
  };

  const comparison = {
    weightedEventsPercent: percentChange(summary.weightedEvents, previousSummary.weightedEvents),
    pageViewsPercent: percentChange(summary.pageViews, previousSummary.pageViews),
    visitorsPercent: percentChange(summary.observedVisitors, previousSummary.observedVisitors),
    sessionsPercent: percentChange(summary.observedSessions, previousSummary.observedSessions)
  };

  return {
    generatedAt: new Date().toISOString(),
    range: {
      start: range.start.toISOString(),
      end: range.end.toISOString(),
      bucketSeconds: range.bucketSeconds
    },
    summary,
    previousSummary,
    comparison,
    trend: (result.trend ?? []).map(row => ({
      bucket: numberOrZero(row.bucket),
      weightedEvents: numberOrZero(row.events),
      pageViews: numberOrZero(row.page_views),
      observedVisitors: numberOrZero(row.visitors),
      observedSessions: numberOrZero(row.sessions)
    })),
    events: (result.events ?? []).map(row => ({
      event: String(row.event ?? ""),
      weightedEvents: numberOrZero(row.events),
      observedVisitors: numberOrZero(row.visitors)
    })),
    routes: (result.routes ?? []).map(row => ({
      route: String(row.route ?? ""),
      views: numberOrZero(row.views),
      observedVisitors: numberOrZero(row.visitors)
    })),
    games: (result.games ?? []).map(row => ({
      gameId: String(row.game_id ?? ""),
      views: numberOrZero(row.views),
      observedVisitors: numberOrZero(row.visitors)
    })),
    notes: [
      "Weighted event and page-view totals use _sample_interval so totals remain statistically correct when Analytics Engine sampling occurs.",
      "Visitor and session counts are observed distinct anonymous identifiers, not personally identified humans.",
      "Returning visitors are calculated with a 30-day lookback before the selected range.",
      "Hourly buckets are used for ranges up to 48 hours; longer ranges use daily buckets.",
      "Analytics data is read-only and is not written back into the public product."
    ]
  };
}

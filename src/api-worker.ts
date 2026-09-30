import { summarizeObservability } from "./observability";

interface AnalyticsBinding {
  writeDataPoint(data: { blobs?: string[]; doubles?: number[]; indexes?: string[] }): void;
}

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SECRET_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  ANALYTICS?: AnalyticsBinding;
}

type FetchLike = typeof fetch;
type JsonRow = Record<string, unknown>;

const DEFAULT_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "public, max-age=15"
};

const SOCIAL_PERIOD_LABELS: Record<string, string> = {
  live: "right now",
  week: "this week",
  month: "this month",
  year: "this year"
};

function rankingPagePath(period: string): string {
  if (period === "week") return "/rankings/weekly";
  if (period === "month") return "/rankings/monthly";
  if (period === "year") return "/rankings/yearly";
  return "/";
}

const RANKING_PERIODS: Record<string, string> = {
  live: "live",
  week: "weekly",
  month: "monthly",
  year: "yearly",
  weekly: "weekly",
  monthly: "monthly",
  yearly: "yearly"
};

const RANKING_RULES = {
  rulesVersion: "2026-09-28",
  methodologyVersion: "2026-09-28",
  title: "How Bobaks Rankings Work",
  topN: 100,
  collection: {
    cadenceMinutes: 10,
    source: "Roblox public experience data collected by Bobaks Ranking"
  },
  timezone: "UTC",
  score: {
    live: "Latest qualifying player-count snapshot.",
    weekly: "Average player count across qualifying samples in the current UTC calendar week, Monday through Sunday.",
    monthly: "Average player count across qualifying samples in the current UTC calendar month.",
    yearly: "Weighted average player count across the current UTC day plus the prior 364 UTC calendar days. Prior complete days use DailyGameStat summaries; the current day uses raw GameSnapshot samples."
  },
  eligibility: {
    live: "A game must be active and have a qualifying snapshot no older than 15 minutes at ranking calculation time.",
    weekly: {
      minimumSamples: 12,
      minimumCoverage: 0.5,
      coverageFormula: "Qualifying snapshots for the game divided by successful or partial collection runs in the ranking period."
    },
    monthly: {
      minimumSamples: 12,
      minimumCoverage: 0.5,
      coverageFormula: "Qualifying snapshots for the game divided by successful or partial collection runs in the ranking period."
    },
    yearly: "No separate sample-count or coverage threshold is applied."
  },
  collectionRuns: {
    countedStatuses: ["success", "partial"],
    excludedStatuses: ["failed", "daily_summary_success", "daily_summary_failed"],
    boundaryRule: "For linked snapshots, Weekly and Monthly period membership follows the collection run startedAt. Legacy snapshots without a collectionRunId use their snapshot timestamp."
  },
  ordering: {
    primary: "Score descending.",
    tieBreak: "gameId ascending, deterministic."
  },
  activity: {
    discovery: "Observed games are active and their verification miss streak resets.",
    staleVerification: "Active games not observed for 24 hours enter explicit Roblox verification.",
    deactivation: "A game is deactivated after 12 consecutive verification misses.",
    reactivation: "A later discovery reactivates the game and clears the inactive state."
  },
  integrity: {
    transaction: "Ranking replacement is protected by a transaction and advisory lock.",
    validation: "A server-side integrity check validates row counts, rank continuity, duplicate games, score validity, ordering, active-game membership, Live freshness, and period-specific score and eligibility rules before commit.",
    failureBehavior: "An invalid ranking refresh raises an error and rolls back instead of committing a bad ranking set."
  },
  limitations: [
    "Rankings represent Bobaks collection snapshots, not every moment of Roblox activity.",
    "Roblox discovery and API availability can limit which games are observed in a cycle.",
    "Coverage is based on Bobaks collection runs, not on all possible Roblox observations."
  ]
};

function requiredSupabaseKey(env: Env): string {
  const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Missing SUPABASE_SECRET_KEY");
  return key;
}

function json(body: unknown, status = 200, extraHeaders: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...DEFAULT_HEADERS, ...extraHeaders }
  });
}

function corsHeaders(): HeadersInit {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type"
  };
}

function recordApiAnalytics(env: Env, request: Request, response: Response): void {
  if (!env.ANALYTICS || request.method !== "GET") return;

  try {
    const url = new URL(request.url);
    const path = url.pathname;
    const route = path.replace(/^\/api\/games\/\d+$/, "/api/games/:id")
      .replace(/^\/api\/games\/\d+\/history$/, "/api/games/:id/history")
      .replace(/^\/api\/games\/\d+\/rank-history$/, "/api/games/:id/rank-history")
      .replace(/^\/api\/games\/\d+\/peak$/, "/api/games/:id/peak");
    const period = url.searchParams.get("period") ?? "";
    const allowedPeriod = new Set(["live","week","month","year"]).has(period) ? period : "";
    env.ANALYTICS.writeDataPoint({
      blobs: ["api_request", route, allowedPeriod],
      doubles: [1, response.status],
      indexes: ["api_request"]
    });
  } catch (error) {
    console.warn("API analytics write failed:", error);
  }
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders())) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function parseHistoryDays(value: string | null): number {
  if (value == null || value === "") return 7;
  const days = Number(value);
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    throw new Error("Invalid days");
  }
  return days;
}

function parseSearch(value: string | null): string {
  const q = (value ?? "").trim();
  if (!q) throw new Error("Missing q");
  if (q.length > 100) throw new Error("Search query too long");
  return q;
}


function parseObservabilityHours(value: string | null): number {
  if (value == null || value === "") return 24;
  const hours = Number(value);
  if (!Number.isInteger(hours) || hours < 1 || hours > 168) {
    throw new Error("Invalid hours");
  }
  return hours;
}

async function getOperationalObservability(
  env: Env,
  hours: number,
  fetchImpl: FetchLike
): Promise<import("./observability").ObservabilitySummary> {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const rows = await supabaseGetPaged(
    env,
    "DataCollectionLog",
    {
      select: "startedAt,finishedAt,status,gamesChecked,gamesUpdated,errors,rankingRefreshStatus,rankingRefreshStartedAt,rankingRefreshFinishedAt",
      status: "in.(success,partial,failed)",
      startedAt: "gte." + cutoff,
      order: "startedAt.desc"
    },
    fetchImpl,
    500
  );

  return summarizeObservability(rows, hours);
}


function supabaseUrl(env: Env, path: string, params: Record<string, string> = {}): string {
  const base = env.SUPABASE_URL.replace(/\/$/, "");
  const url = new URL(`${base}/rest/v1/${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

async function supabaseGet(
  env: Env,
  path: string,
  params: Record<string, string>,
  fetchImpl: FetchLike
): Promise<JsonRow[]> {
  const key = requiredSupabaseKey(env);
  const headers = new Headers({
    apikey: key,
    accept: "application/json"
  });

  if (!key.startsWith("sb_")) {
    headers.set("authorization", `Bearer ${key}`);
  }

  const response = await fetchImpl(supabaseUrl(env, path, params), { headers });
  const body = await response.text();

  if (!response.ok) {
    throw new Error(`Supabase HTTP ${response.status}: ${body.slice(0, 300)}`);
  }

  if (!body.trim()) return [];
  const data = JSON.parse(body) as unknown;
  if (!Array.isArray(data)) throw new Error("Supabase returned an invalid response");
  return data as JsonRow[];
}

async function supabaseGetPaged(
  env: Env,
  path: string,
  params: Record<string, string>,
  fetchImpl: FetchLike,
  pageSize = 500
): Promise<JsonRow[]> {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000) {
    throw new Error("Invalid Supabase page size");
  }

  const rows: JsonRow[] = [];
  let offset = 0;

  while (true) {
    const page = await supabaseGet(
      env,
      path,
      { ...params, limit: String(pageSize), offset: String(offset) },
      fetchImpl
    );

    rows.push(...page);

    if (page.length < pageSize) break;
    offset += pageSize;
  }

  return rows;
}

async function supabaseRpc(
  env: Env,
  functionName: string,
  body: Record<string, unknown>,
  fetchImpl: FetchLike
): Promise<unknown> {
  const key = requiredSupabaseKey(env);
  const headers = new Headers({
    apikey: key,
    "content-type": "application/json",
    accept: "application/json"
  });

  if (!key.startsWith("sb_")) {
    headers.set("authorization", `Bearer ${key}`);
  }

  const response = await fetchImpl(
    `${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/rpc/${functionName}`,
    { method: "POST", headers, body: JSON.stringify(body) }
  );

  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`Supabase RPC HTTP ${response.status}: ${bodyText.slice(0, 300)}`);
  }

  if (!bodyText.trim()) return null;
  return JSON.parse(bodyText) as unknown;
}



function gameSelect(): string {
  return "id,universeId,placeId,name,creatorName,creatorId,iconUrl,description,createdAt,updatedAt,isActive";
}

function parseGamesPagination(url: URL): { limit: number; offset: number } {
  const rawLimit = url.searchParams.get("limit");
  const rawOffset = url.searchParams.get("offset");
  const limit = rawLimit == null || rawLimit === "" ? 100 : Number(rawLimit);
  const offset = rawOffset == null || rawOffset === "" ? 0 : Number(rawOffset);

  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Invalid limit");
  }
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new Error("Invalid offset");
  }

  return { limit, offset };
}

async function getGames(
  env: Env,
  fetchImpl: FetchLike,
  pagination: { limit: number; offset: number }
): Promise<JsonRow[]> {
  return supabaseGet(
    env,
    "Game",
    {
      select: gameSelect(),
      isActive: "eq.true",
      order: "name.asc",
      limit: String(pagination.limit),
      offset: String(pagination.offset)
    },
    fetchImpl
  );
}

async function getGameById(env: Env, id: string, fetchImpl: FetchLike): Promise<JsonRow | null> {
  const [rows, currentStatsRaw, rankingRows] = await Promise.all([
    supabaseGet(
      env,
      "Game",
      {
        select: gameSelect(),
        id: `eq.${id}`,
        isActive: "eq.true",
        limit: "1"
      },
      fetchImpl
    ),
    supabaseRpc(
      env,
      "get_game_current_stats",
      { p_game_id: Number(id) },
      fetchImpl
    ),
    supabaseGet(
      env,
      "Ranking",
      {
        select: "period,rank,score,previousRank,calculatedAt",
        gameId: `eq.${id}`,
        order: "period.asc",
        limit: "10"
      },
      fetchImpl
    )
  ]);

  const game = rows[0];
  if (!game) return null;

  const currentStats = Array.isArray(currentStatsRaw)
    ? currentStatsRaw[0]
    : currentStatsRaw && typeof currentStatsRaw === "object"
      ? currentStatsRaw as JsonRow
      : null;

  const rankings: Record<string, JsonRow> = {};
  for (const row of rankingRows) {
    const rank = Number(row.rank);
    const previousRank = row.previousRank == null ? null : Number(row.previousRank);
    rankings[String(row.period)] = {
      rank,
      score: Number(row.score),
      previousRank,
      rankChange: previousRank == null ? null : previousRank - rank,
      calculatedAt: row.calculatedAt ?? null
    };
  }

  const liveRanking = rankings.live;

  return {
    ...game,
    currentPlayers: Number(currentStats?.playerCount ?? liveRanking?.score ?? 0),
    currentSnapshotAt: currentStats?.snapshotAt ?? null,
    rankings
  };
}

const RAW_HISTORY_DAYS = 31;

function utcDayStart(date: Date): Date {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate()
  ));
}

async function getHistory(
  env: Env,
  gameId: string,
  days: number,
  fetchImpl: FetchLike
): Promise<{ data: JsonRow[]; resolution: "snapshot" | "mixed" | "daily" }> {
  const now = new Date();
  const requestedSince = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const rollingRawSince = new Date(now.getTime() - RAW_HISTORY_DAYS * 24 * 60 * 60 * 1000);
  // Split long history at a UTC day boundary so daily summaries and raw
  // snapshots do not leave a partial-day gap at the retention boundary.
  const rawSince = utcDayStart(rollingRawSince);

  const rawFrom = requestedSince > rollingRawSince ? requestedSince : rawSince;
  const rawRowsPromise = supabaseGetPaged(
    env,
    "GameSnapshot",
    {
      select: "id,gameId,playerCount,timestamp",
      gameId: `eq.${gameId}`,
      timestamp: `gte.${rawFrom.toISOString()}`,
      order: "timestamp.asc,id.asc"
    },
    fetchImpl
  );

  if (requestedSince >= rawSince) {
    const rawRows = await rawRowsPromise;
    return {
      resolution: "snapshot",
      data: rawRows.map(row => ({ ...row, resolution: "snapshot" }))
    };
  }

  const summaryFrom = utcDayStart(requestedSince).toISOString();
  const summaryUntil = utcDayStart(rawSince).toISOString();

  const summaryRowsPromise = supabaseGetPaged(
    env,
    "DailyGameStat",
    {
      select: "id,gameId,date,averagePlayers,peakPlayers,lowestPlayers,totalSamples",
      gameId: `eq.${gameId}`
    },
    fetchImpl
  );

  const [rawRows, summaryRows] = await Promise.all([
    rawRowsPromise,
    summaryRowsPromise
  ]);

  const summaryRowsInRange = summaryRows.filter(row => {
    const timestamp = Date.parse(String(row.date ?? ""));
    return Number.isFinite(timestamp) &&
      timestamp >= Date.parse(summaryFrom) &&
      timestamp < Date.parse(summaryUntil);
  });

  const data: JsonRow[] = [
    ...summaryRowsInRange.map(row => ({
      id: row.id,
      gameId: row.gameId,
      playerCount: Number(row.averagePlayers),
      timestamp: row.date,
      averagePlayers: Number(row.averagePlayers),
      peakPlayers: Number(row.peakPlayers),
      lowestPlayers: Number(row.lowestPlayers),
      totalSamples: Number(row.totalSamples),
      resolution: "daily"
    })),
    ...rawRows.map(row => ({ ...row, resolution: "snapshot" }))
  ];

  data.sort((a, b) => {
    const at = Date.parse(String(a.timestamp ?? ""));
    const bt = Date.parse(String(b.timestamp ?? ""));
    return at - bt || String(a.id ?? "").localeCompare(String(b.id ?? ""), undefined, { numeric: true });
  });

  const hasSummary = summaryRowsInRange.length > 0;
  const hasRaw = rawRows.length > 0;
  const resolution = hasSummary && hasRaw ? "mixed" : hasSummary ? "daily" : "snapshot";

  return { resolution, data };
}

async function getGameRankHistory(
  env: Env,
  gameId: string,
  days: number,
  fetchImpl: FetchLike
): Promise<JsonRow[]> {
  const result = await supabaseRpc(
    env,
    "get_game_rank_history",
    {
      p_game_id: Number(gameId),
      p_days: days
    },
    fetchImpl
  );

  if (!Array.isArray(result)) {
    throw new Error("Game rank history returned an invalid response");
  }

  return result.map(row => ({
    date: row.date,
    rank: Number(row.rank),
    averagePlayers: Number(row.averagePlayers),
    gamesRanked: Number(row.gamesRanked)
  }));
}

async function getPeak(env: Env, gameId: string, fetchImpl: FetchLike): Promise<JsonRow | null> {
  const rows = await supabaseGet(
    env,
    "GamePeak",
    {
      select: "id,gameId,peakPlayers,peakAt",
      gameId: `eq.${gameId}`,
      limit: "1"
    },
    fetchImpl
  );
  return rows[0] ?? null;
}

async function getGamesByIds(env: Env, ids: string[], fetchImpl: FetchLike): Promise<Map<string, JsonRow>> {
  const map = new Map<string, JsonRow>();
  if (!ids.length) return map;

  const uniqueIds = [...new Set(ids)];
  const rows = await supabaseGet(
    env,
    "Game",
    {
      select: gameSelect(),
      id: `in.(${uniqueIds.join(",")})`
    },
    fetchImpl
  );

  for (const row of rows) {
    if (row.id != null) map.set(String(row.id), row);
  }

  return map;
}

async function getActiveGamesForRanking(env: Env, fetchImpl: FetchLike): Promise<Map<string, JsonRow>> {
  const rows = await supabaseGet(
    env,
    "Game",
    {
      select: gameSelect(),
      isActive: "eq.true",
      order: "id.asc",
      limit: "500"
    },
    fetchImpl
  );

  const map = new Map<string, JsonRow>();
  for (const row of rows) {
    if (row.id != null) map.set(String(row.id), row);
  }
  return map;
}

async function getRankings(
  env: Env,
  period: string,
  fetchImpl: FetchLike
): Promise<JsonRow[]> {
  const dbPeriod = RANKING_PERIODS[period];
  if (!dbPeriod) throw new Error("Invalid period");

  const rankingsPromise = supabaseGet(
    env,
    "Ranking",
    {
      select: "id,gameId,period,rank,score,previousRank,calculatedAt",
      period: `eq.${dbPeriod}`,
      order: "rank.asc",
      limit: "100"
    },
    fetchImpl
  );
  // Keep ranking and active-game metadata reads concurrent to minimize API TTFB.
  const activeGamesPromise = getActiveGamesForRanking(env, fetchImpl);

  const rankings = await rankingsPromise;
  const gameMap = await activeGamesPromise;

  const missingGameIds = rankings
    .map(row => String(row.gameId ?? ""))
    .filter(id => id && !gameMap.has(id));
  if (missingGameIds.length) {
    const missingGames = await getGamesByIds(env, missingGameIds, fetchImpl);
    for (const [id, game] of missingGames) gameMap.set(id, game);
  }

  return rankings.map(row => ({
    ...row,
    gameId: row.gameId == null ? null : String(row.gameId),
    rank: Number(row.rank),
    score: Number(row.score),
    previousRank: row.previousRank == null ? null : Number(row.previousRank),
    rankChange: row.previousRank == null ? null : Number(row.previousRank) - Number(row.rank),
    game: gameMap.get(String(row.gameId ?? "")) ?? null
  }));
}

function socialRankingTitle(period: string): string {
  return "🔥 Top 10 Roblox games " + (SOCIAL_PERIOD_LABELS[period] ?? "right now");
}

function socialTrendingTitle(period: string): string {
  return "📈 Trending Roblox games " + (SOCIAL_PERIOD_LABELS[period] ?? "right now");
}

function buildSocialRankingPost(
  period: string,
  items: Array<{ rank: number; name: string; score: number }>,
  url: string
): string {
  const unit = period === "live" ? "players" : "avg players";
  const lines = items.slice(0, 10).map(item =>
    item.rank + ". " + item.name + " · " + Math.max(0, Math.round(item.score)) + " " + unit
  );
  return [socialRankingTitle(period), "", ...lines, "", "Visit Bobaks Ranking:", url].join("\n");
}

function buildSocialTrendingPost(
  period: string,
  items: Array<{ rank: number; name: string; score: number; rankChange: number }>,
  url: string
): string {
  const lines = items.slice(0, 10).map(item =>
    "▲ " + item.name + " · +" + item.rankChange + " ranks · #" + item.rank + " · " +
    Math.max(0, Math.round(item.score)) + (period === "live" ? " players" : " avg players")
  );
  return [socialTrendingTitle(period), "", ...lines, "", "Visit Bobaks Ranking:", url].join("\n");
}

function buildSocialPeakPost(
  items: Array<{ name: string; peakPlayers: number; peakAt: string | null; url: string }>
): string {
  const lines = items.slice(0, 10).map(item => {
    const date = item.peakAt ? String(item.peakAt).slice(0, 10) : "date unavailable";
    return "🏆 " + item.name + " · " + Math.max(0, Math.round(item.peakPlayers)) + " peak players · " +
      date + " · " + item.url;
  });
  return ["🏆 Highest recorded Roblox peaks on Bobaks", "", ...lines].join("\n");
}

async function getSocialFeed(
  env: Env,
  period: string,
  origin: string,
  fetchImpl: FetchLike
): Promise<Record<string, unknown>> {
  const rankings = await getRankings(env, period, fetchImpl);
  const rankingItems = rankings.slice(0, 10).map(row => ({
    rank: Number(row.rank),
    gameId: String(row.gameId ?? ""),
    name: String((row.game as JsonRow | null)?.name ?? "Unknown game"),
    creator: String((row.game as JsonRow | null)?.creatorName ?? "Unknown creator"),
    score: Number(row.score) || 0,
    rankChange: row.rankChange == null ? null : Number(row.rankChange)
  }));

  const trendingItems = rankings
    .filter(row => Number(row.rankChange ?? 0) > 0)
    .sort((a, b) => {
      const changeDiff = Number(b.rankChange ?? 0) - Number(a.rankChange ?? 0);
      if (changeDiff !== 0) return changeDiff;
      const scoreDiff = Number(b.score ?? 0) - Number(a.score ?? 0);
      if (scoreDiff !== 0) return scoreDiff;
      const rankDiff = Number(a.rank ?? 0) - Number(b.rank ?? 0);
      if (rankDiff !== 0) return rankDiff;
      return String(a.gameId ?? "").localeCompare(String(b.gameId ?? ""));
    })
    .slice(0, 10)
    .map(row => ({
      rank: Number(row.rank),
      gameId: String(row.gameId ?? ""),
      name: String((row.game as JsonRow | null)?.name ?? "Unknown game"),
      creator: String((row.game as JsonRow | null)?.creatorName ?? "Unknown creator"),
      score: Number(row.score) || 0,
      rankChange: Number(row.rankChange) || 0
    }));

  const [peakRows, recentPeakRows] = await Promise.all([
    supabaseGet(
      env,
      "GamePeak",
      {
        select: "id,gameId,peakPlayers,peakAt",
        order: "peakPlayers.desc",
        limit: "10"
      },
      fetchImpl
    ),
    supabaseGet(
      env,
      "GamePeak",
      {
        select: "id,gameId,peakPlayers,peakAt",
        order: "peakAt.desc",
        limit: "50"
      },
      fetchImpl
    )
  ]);

  const peakMap = await getGamesByIds(
    env,
    [...peakRows, ...recentPeakRows].map(row => String(row.gameId ?? "")),
    fetchImpl
  );

  const mapPeakRows = (rows: JsonRow[]) => rows
    .map(row => {
      const gameId = String(row.gameId ?? "");
      const game = peakMap.get(gameId);
      if (!game) return null;
      return {
        gameId,
        name: String(game.name ?? "Unknown game"),
        creator: String(game.creatorName ?? "Unknown creator"),
        peakPlayers: Number(row.peakPlayers) || 0,
        peakAt: row.peakAt == null ? null : String(row.peakAt),
        url: new URL("/game/" + encodeURIComponent(gameId), origin).toString()
      };
    })
    .filter((row): row is {
      gameId: string; name: string; creator: string; peakPlayers: number; peakAt: string | null; url: string;
    } => row !== null);

  const peaks = mapPeakRows(peakRows).slice(0, 10);
  const recentPeaks = mapPeakRows(recentPeakRows).slice(0, 50);

  const rankingUrl = new URL(rankingPagePath(period), origin).toString();

  return {
    generatedAt: new Date().toISOString(),
    source: "Bobaks collected game-level data",
    period,
    ranking: {
      title: socialRankingTitle(period),
      path: rankingPagePath(period),
      items: rankingItems
    },
    trending: {
      title: socialTrendingTitle(period),
      path: rankingPagePath(period),
      items: trendingItems
    },
    peaks: {
      title: "Highest recorded Roblox peaks on Bobaks",
      items: peaks,
      recentItems: recentPeaks
    },
    posts: {
      ranking: {
        title: socialRankingTitle(period),
        url: rankingUrl,
        text: buildSocialRankingPost(period, rankingItems, rankingUrl)
      },
      trending: {
        title: socialTrendingTitle(period),
        url: rankingUrl,
        text: buildSocialTrendingPost(period, trendingItems, rankingUrl)
      },
      peaks: {
        title: "Highest recorded Roblox peaks on Bobaks",
        text: buildSocialPeakPost(peaks)
      }
    }
  };
}

const COLLECTION_INTERVAL_MS = 10 * 60 * 1000;
const COLLECTION_REFRESH_BUFFER_MS = 15 * 1000;

async function getNextCollectionAt(
  env: Env,
  fetchImpl: FetchLike
): Promise<string> {
  const rows = await supabaseGet(
    env,
    "DataCollectionLog",
    {
      select: "startedAt,status",
      status: "in.(success,partial,failed)",
      order: "startedAt.desc",
      limit: "1"
    },
    fetchImpl
  );

  const latestStartedAt = rows[0]?.startedAt == null
    ? NaN
    : Date.parse(String(rows[0].startedAt));

  if (Number.isFinite(latestStartedAt)) {
    let next = latestStartedAt + COLLECTION_INTERVAL_MS + COLLECTION_REFRESH_BUFFER_MS;
    const now = Date.now();
    while (next <= now) next += COLLECTION_INTERVAL_MS;
    return new Date(next).toISOString();
  }

  const now = Date.now();
  const nextBoundary = (Math.floor(now / COLLECTION_INTERVAL_MS) + 1) * COLLECTION_INTERVAL_MS;
  return new Date(nextBoundary + COLLECTION_REFRESH_BUFFER_MS).toISOString();
}

async function getRankingResponse(
  env: Env,
  period: string,
  fetchImpl: FetchLike
): Promise<Record<string, unknown>> {
  const [data, nextCollectionAt] = await Promise.all([
    getRankings(env, period, fetchImpl),
    getNextCollectionAt(env, fetchImpl)
  ]);
  const updatedAt = data[0]?.calculatedAt ?? null;
  const refreshIntervalSeconds = COLLECTION_INTERVAL_MS / 1000;

  return {
    period,
    updatedAt,
    refreshIntervalSeconds,
    nextCollectionAt,
    nextRefreshAt: nextCollectionAt,
    data
  };
}

async function searchGames(
  env: Env,
  q: string,
  fetchImpl: FetchLike
): Promise<JsonRow[]> {
  const [nameMatches, creatorMatches] = await Promise.all([
    supabaseGet(
      env,
      "Game",
      {
        select: gameSelect(),
        isActive: "eq.true",
        name: `ilike.*${q}*`,
        order: "name.asc",
        limit: "50"
      },
      fetchImpl
    ),
    supabaseGet(
      env,
      "Game",
      {
        select: gameSelect(),
        isActive: "eq.true",
        creatorName: `ilike.*${q}*`,
        order: "name.asc",
        limit: "50"
      },
      fetchImpl
    )
  ]);

  const byId = new Map<string, JsonRow>();
  for (const row of [...nameMatches, ...creatorMatches]) {
    if (row.id != null) byId.set(String(row.id), row);
  }

  return [...byId.values()]
    .sort((a, b) =>
      String(a.name ?? "").localeCompare(String(b.name ?? ""), undefined, { sensitivity: "base" })
    )
    .slice(0, 50);
}

async function getRankingAudit(
  env: Env,
  fetchImpl: FetchLike
): Promise<JsonRow> {
  const result = await supabaseRpc(env, "get_rankings_audit", {}, fetchImpl);
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("Ranking audit returned an invalid response");
  }
  return result as JsonRow;
}

async function health(env: Env, fetchImpl: FetchLike): Promise<Response> {
  try {
    await supabaseGet(env, "Game", { select: "id", limit: "1" }, fetchImpl);
    return json({
      ok: true,
      service: "bobaks-ranking-api",
      database: "connected",
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("API health check failed:", error);
    return json({
      ok: false,
      service: "bobaks-ranking-api",
      database: "unavailable",
      timestamp: new Date().toISOString()
    }, 503);
  }
}

const HEALTH_THRESHOLDS = {
  collectionFreshnessSeconds: 15 * 60,
  dailySummaryFreshnessSeconds: 26 * 60 * 60,
  rankingRefreshPendingSeconds: 5 * 60,
  failureLookbackSeconds: 30 * 60
};

async function getDeepHealth(env: Env, fetchImpl: FetchLike): Promise<Record<string, unknown>> {
  const nowMs = Date.now();

  const failureCutoff = new Date(
    nowMs - HEALTH_THRESHOLDS.failureLookbackSeconds * 1000
  ).toISOString();

  const [
    audit,
    latestCollectionRows,
    latestGoodCollectionRows,
    latestDailySummaryRows,
    recentCollectionFailuresRows,
    recentRankingRefreshFailuresRows
  ] = await Promise.all([
    getRankingAudit(env, fetchImpl),
    supabaseGet(env, "DataCollectionLog", {
      select: "collectionRunId,startedAt,finishedAt,status,gamesChecked,gamesUpdated,errors,errorMessage,rankingRefreshStatus,rankingRefreshStartedAt,rankingRefreshFinishedAt,rankingRefreshErrorMessage",
      status: "in.(success,partial,failed)",
      order: "startedAt.desc",
      limit: "1"
    }, fetchImpl),
    supabaseGet(env, "DataCollectionLog", {
      select: "startedAt,finishedAt,status,gamesChecked,gamesUpdated,errors",
      status: "in.(success,partial)",
      order: "startedAt.desc",
      limit: "1"
    }, fetchImpl),
    supabaseGet(env, "DataCollectionLog", {
      select: "startedAt,finishedAt,status,gamesUpdated,errors,errorMessage",
      status: "in.(daily_summary_success,daily_summary_failed)",
      order: "startedAt.desc",
      limit: "1"
    }, fetchImpl),
    supabaseGet(env, "DataCollectionLog", {
      select: "collectionRunId,startedAt,finishedAt,status,gamesChecked,gamesUpdated,errors,errorMessage",
      status: "eq.failed",
      startedAt: "gte." + failureCutoff,
      order: "startedAt.desc",
      limit: "20"
    }, fetchImpl),
    supabaseGet(env, "DataCollectionLog", {
      select: "collectionRunId,startedAt,rankingRefreshStartedAt,rankingRefreshFinishedAt,rankingRefreshStatus,rankingRefreshErrorMessage",
      rankingRefreshStatus: "eq.failed",
      rankingRefreshStartedAt: "gte." + failureCutoff,
      order: "rankingRefreshStartedAt.desc",
      limit: "20"
    }, fetchImpl)
  ]);

  const latestCollection = latestCollectionRows[0] ?? {};
  const latestGoodCollection = latestGoodCollectionRows[0] ?? {};
  const latestDailySummary = latestDailySummaryRows[0] ?? {};
  const recentCollectionFailures = recentCollectionFailuresRows;
  const recentRankingRefreshFailures = recentRankingRefreshFailuresRows;

  const latestGoodCollectionMs = Date.parse(String(latestGoodCollection.startedAt ?? ""));
  const latestCollectionMs = Date.parse(String(latestCollection.startedAt ?? ""));
  const latestSummaryMs = Date.parse(String(latestDailySummary.startedAt ?? ""));

  const collectionAgeSeconds = Number.isFinite(latestGoodCollectionMs)
    ? Math.max(0, Math.floor((nowMs - latestGoodCollectionMs) / 1000))
    : null;
  const dailySummaryAgeSeconds = Number.isFinite(latestSummaryMs)
    ? Math.max(0, Math.floor((nowMs - latestSummaryMs) / 1000))
    : null;

  const latestCollectionStatus = String(latestCollection.status ?? "unknown");
  const collectionFresh = collectionAgeSeconds != null &&
    collectionAgeSeconds <= HEALTH_THRESHOLDS.collectionFreshnessSeconds;
  const collectionStatus =
    latestCollectionStatus === "success" && collectionFresh
      ? "healthy"
      : collectionFresh || latestCollectionStatus === "partial"
        ? "degraded"
        : "unhealthy";

  const summaryFresh = dailySummaryAgeSeconds != null &&
    dailySummaryAgeSeconds <= HEALTH_THRESHOLDS.dailySummaryFreshnessSeconds;
  const dailySummaryStatus =
    latestDailySummary.status === "daily_summary_success" && summaryFresh
      ? "healthy"
      : summaryFresh
        ? "degraded"
        : "unhealthy";

  const auditStatus = String(audit.auditStatus ?? "unknown");
  const rankings = audit.rankings && typeof audit.rankings === "object"
    ? audit.rankings as Record<string, unknown>
    : {};
  const live = rankings.live && typeof rankings.live === "object"
    ? rankings.live as Record<string, unknown>
    : {};
  const liveAge = Number(live.maxLatestSnapshotAgeSeconds);
  const rankingRowsHealthy =
    Number(live.rows) === 100 &&
    Number((rankings.weekly as Record<string, unknown> | undefined)?.rows) === 100 &&
    Number((rankings.monthly as Record<string, unknown> | undefined)?.rows) === 100 &&
    Number((rankings.yearly as Record<string, unknown> | undefined)?.rows) === 100;

  const rankingRefreshStatus = String(latestCollection.rankingRefreshStatus ?? "unknown");
  const rankingRefreshStartedMs = Date.parse(String(latestCollection.rankingRefreshStartedAt ?? ""));
  const rankingRefreshAgeSeconds = Number.isFinite(rankingRefreshStartedMs)
    ? Math.max(0, Math.floor((nowMs - rankingRefreshStartedMs) / 1000))
    : null;
  const rankingRefreshPendingStale =
    rankingRefreshStatus === "pending" &&
    (rankingRefreshAgeSeconds == null ||
      rankingRefreshAgeSeconds > HEALTH_THRESHOLDS.rankingRefreshPendingSeconds);
  const rankingRefreshOperationalStatus =
    rankingRefreshStatus === "failed" || rankingRefreshPendingStale
      ? "unhealthy"
      : rankingRefreshStatus === "pending"
        ? "degraded"
        : "healthy";

  const baseRankingsHealthy =
    auditStatus === "passed" &&
    rankingRowsHealthy &&
    Number.isFinite(liveAge) &&
    liveAge <= HEALTH_THRESHOLDS.collectionFreshnessSeconds;

  const rankingsStatus =
    !baseRankingsHealthy || rankingRefreshOperationalStatus === "unhealthy"
      ? "unhealthy"
      : rankingRefreshOperationalStatus === "degraded"
        ? "degraded"
        : "healthy";

  const historicalRecovery = audit.historicalRecovery &&
    typeof audit.historicalRecovery === "object"
    ? audit.historicalRecovery as Record<string, unknown>
    : {};
  const historyStatus = String(historicalRecovery.status ?? "unknown") === "passed"
    ? "healthy"
    : "unhealthy";

  const databaseStatus = "healthy";
  const degraded =
    collectionStatus === "degraded" ||
    dailySummaryStatus === "degraded" ||
    rankingsStatus === "degraded";

  const recentCollectionFailureCount = recentCollectionFailures.length;
  const recentRankingRefreshFailureCount = recentRankingRefreshFailures.length;
  const alertReasons: string[] = [];

  if (recentCollectionFailureCount > 0) {
    alertReasons.push(
      recentCollectionFailureCount === 1
        ? "A collection run failed within the last 30 minutes."
        : recentCollectionFailureCount + " collection runs failed within the last 30 minutes."
    );
  }

  if (recentRankingRefreshFailureCount > 0) {
    alertReasons.push(
      recentRankingRefreshFailureCount === 1
        ? "A ranking refresh failed within the last 30 minutes."
        : recentRankingRefreshFailureCount + " ranking refreshes failed within the last 30 minutes."
    );
  }

  if (rankingRefreshPendingStale) {
    alertReasons.push("A ranking refresh has been pending for more than 5 minutes.");
  }

  if (
    collectionStatus === "unhealthy" ||
    dailySummaryStatus === "unhealthy" ||
    rankingsStatus === "unhealthy" ||
    historyStatus === "unhealthy"
  ) {
    alertReasons.push("Deep production health is currently unhealthy.");
  }

  const alertActive = alertReasons.length > 0;
  const unhealthy =
    collectionStatus === "unhealthy" ||
    dailySummaryStatus === "unhealthy" ||
    rankingsStatus === "unhealthy" ||
    historyStatus === "unhealthy";

  return {
    ok: !unhealthy,
    status: unhealthy ? "unhealthy" : degraded ? "degraded" : "healthy",
    service: "bobaks-ranking-api",
    timestamp: new Date(nowMs).toISOString(),
    checks: {
      database: { status: databaseStatus },
      collection: {
        status: collectionStatus,
        latestStatus: latestCollectionStatus,
        latestStartedAt: latestCollection.startedAt ?? null,
        lastGoodStartedAt: latestGoodCollection.startedAt ?? null,
        ageSeconds: collectionAgeSeconds,
        freshnessThresholdSeconds: HEALTH_THRESHOLDS.collectionFreshnessSeconds
      },
      dailySummary: {
        status: dailySummaryStatus,
        latestStatus: latestDailySummary.status ?? null,
        latestStartedAt: latestDailySummary.startedAt ?? null,
        ageSeconds: dailySummaryAgeSeconds,
        freshnessThresholdSeconds: HEALTH_THRESHOLDS.dailySummaryFreshnessSeconds
      },
      rankings: {
        status: rankingsStatus,
        auditStatus,
        liveRows: Number(live.rows ?? 0),
        weeklyRows: Number((rankings.weekly as Record<string, unknown> | undefined)?.rows ?? 0),
        monthlyRows: Number((rankings.monthly as Record<string, unknown> | undefined)?.rows ?? 0),
        yearlyRows: Number((rankings.yearly as Record<string, unknown> | undefined)?.rows ?? 0),
        maxLatestSnapshotAgeSeconds: Number.isFinite(liveAge) ? liveAge : null
      },
      rankingRefresh: {
        status: rankingRefreshOperationalStatus,
        latestStatus: rankingRefreshStatus,
        startedAt: latestCollection.rankingRefreshStartedAt ?? null,
        finishedAt: latestCollection.rankingRefreshFinishedAt ?? null,
        ageSeconds: rankingRefreshAgeSeconds,
        errorMessage: latestCollection.rankingRefreshErrorMessage ?? null
      },
      historicalRecovery: {
        status: historyStatus,
        recoverableDailyRows: Number(historicalRecovery.recoverableDailyRows ?? 0),
        rawDaysWithoutSummary: Array.isArray(historicalRecovery.rawDaysWithoutSummary)
          ? historicalRecovery.rawDaysWithoutSummary.length
          : null
      }
    },
    alerts: {
      active: alertActive,
      severity: alertActive ? "critical" : "clear",
      lookbackSeconds: HEALTH_THRESHOLDS.failureLookbackSeconds,
      recentCollectionFailureCount,
      recentRankingRefreshFailureCount,
      reasons: alertReasons,
      recentCollectionFailures: recentCollectionFailures.map(row => ({
        collectionRunId: row.collectionRunId ?? null,
        startedAt: row.startedAt ?? null,
        errorMessage: row.errorMessage ?? null
      })),
      recentRankingRefreshFailures: recentRankingRefreshFailures.map(row => ({
        collectionRunId: row.collectionRunId ?? null,
        startedAt: row.startedAt ?? null,
        rankingRefreshStartedAt: row.rankingRefreshStartedAt ?? null,
        rankingRefreshFinishedAt: row.rankingRefreshFinishedAt ?? null,
        errorMessage: row.rankingRefreshErrorMessage ?? null
      }))
    }
  };
}

async function healthDeep(env: Env, fetchImpl: FetchLike): Promise<Response> {
  try {
    const body = await getDeepHealth(env, fetchImpl);
    return json(body, body.status === "unhealthy" ? 503 : 200, {
      "cache-control": "no-store"
    });
  } catch (error) {
    console.error("API deep health check failed:", error);
    return json({
      ok: false,
      status: "unavailable",
      service: "bobaks-ranking-api",
      timestamp: new Date().toISOString()
    }, 503, { "cache-control": "no-store" });
  }
}


async function handleApi(
  request: Request,
  env: Env,
  fetchImpl: FetchLike = fetch
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (path === "/api/health") {
    return health(env, fetchImpl);
  }

  if (path === "/api/health/deep") {
    return healthDeep(env, fetchImpl);
  }

  if (path === "/api/rankings/methodology") {
    return json(RANKING_RULES, 200, { "cache-control": "public, max-age=300" });
  }

  if (path === "/api/rankings/audit") {
    try {
      return json(await getRankingAudit(env, fetchImpl), 200, {
        "cache-control": "public, max-age=60, s-maxage=60"
      });
    } catch (error) {
      console.error("GET /api/rankings/audit failed:", error);
      return json({ error: "Ranking audit unavailable" }, 503);
    }
  }

  if (path === "/api/observability") {
    let hours: number;
    try {
      hours = parseObservabilityHours(url.searchParams.get("hours"));
    } catch {
      return json(
        { error: "Invalid hours parameter. Use an integer from 1 to 168." },
        400
      );
    }

    try {
      return json(await getOperationalObservability(env, hours, fetchImpl), 200, {
        "cache-control": "no-store"
      });
    } catch (error) {
      console.error("GET /api/observability failed:", error);
      return json({ error: "Observability unavailable" }, 503, {
        "cache-control": "no-store"
      });
    }
  }

  if (path === "/api/games") {
    let pagination: { limit: number; offset: number };
    try {
      pagination = parseGamesPagination(url);
    } catch {
      return json({
        error: "Invalid pagination. Use limit 1-100 and a non-negative offset."
      }, 400);
    }

    try {
      return json({ data: await getGames(env, fetchImpl, pagination) }, 200, {
        "cache-control": "public, max-age=60, s-maxage=60"
      });
    } catch (error) {
      console.error("GET /api/games failed:", error);
      return json({ error: "Database unavailable" }, 503);
    }
  }

  const gameMatch = path.match(/^\/api\/games\/(\d+)$/);
  if (gameMatch) {
    try {
      const game = await getGameById(env, gameMatch[1], fetchImpl);
      if (!game) return json({ error: "Game not found" }, 404);
      return json({ data: game }, 200, {
        "cache-control": "public, max-age=60, s-maxage=60"
      });
    } catch (error) {
      console.error("GET /api/games/:id failed:", error);
      return json({ error: "Database unavailable" }, 503);
    }
  }

  const historyMatch = path.match(/^\/api\/games\/(\d+)\/history$/);
  if (historyMatch) {
    let days: number;
    try {
      days = parseHistoryDays(url.searchParams.get("days"));
    } catch {
      return json({ error: "Invalid days parameter. Use an integer from 1 to 365." }, 400);
    }

    try {
      const history = await getHistory(env, historyMatch[1], days, fetchImpl);
      return json({
        gameId: historyMatch[1],
        days,
        resolution: history.resolution,
        data: history.data
      }, 200, {
        "cache-control": "public, max-age=60, s-maxage=300"
      });
    } catch (error) {
      console.error("GET /api/games/:id/history failed:", error);
      return json({ error: "Database unavailable" }, 503);
    }
  }

  const rankHistoryMatch = path.match(/^\/api\/games\/(\d+)\/rank-history$/);
  if (rankHistoryMatch) {
    let days: number;
    try {
      days = parseHistoryDays(url.searchParams.get("days"));
    } catch {
      return json({ error: "Invalid days parameter. Use an integer from 1 to 365." }, 400);
    }

    try {
      return json({
        gameId: rankHistoryMatch[1],
        days,
        data: await getGameRankHistory(env, rankHistoryMatch[1], days, fetchImpl)
      }, 200, {
        "cache-control": "public, max-age=60, s-maxage=60"
      });
    } catch (error) {
      console.error("GET /api/games/:id/rank-history failed:", error);
      return json({ error: "Database unavailable" }, 503);
    }
  }

  const peakMatch = path.match(/^\/api\/games\/(\d+)\/peak$/);
  if (peakMatch) {
    try {
      const peak = await getPeak(env, peakMatch[1], fetchImpl);
      if (!peak) return json({ error: "Peak not found" }, 404);
      return json({ data: peak }, 200, {
        "cache-control": "public, max-age=300, s-maxage=300"
      });
    } catch (error) {
      console.error("GET /api/games/:id/peak failed:", error);
      return json({ error: "Database unavailable" }, 503);
    }
  }

  if (path === "/api/rankings/rules") {
    // Backward-compatible alias for the canonical methodology endpoint.
    return json(RANKING_RULES, 200, {
      "cache-control": "public, max-age=300"
    });
  }

  const rankingPath = path.match(/^\/api\/rankings(?:\/(live|weekly|monthly|yearly))?$/);
  if (rankingPath) {
    const period = rankingPath[1]
      ? rankingPath[1] === "weekly"
        ? "week"
        : rankingPath[1] === "monthly"
          ? "month"
          : rankingPath[1] === "yearly"
            ? "year"
            : "live"
      : url.searchParams.get("period") || "live";

    if (!RANKING_PERIODS[period]) {
      return json({ error: "Invalid period. Use live, week, month, or year." }, 400);
    }

    try {
      return json(
        await getRankingResponse(env, period, fetchImpl),
        200,
        { "cache-control": "no-store, no-cache, must-revalidate" }
      );
    } catch (error) {
      console.error("GET /api/rankings failed:", error);
      return json({ error: "Database unavailable" }, 503);
    }
  }

  if (path === "/api/social/feed") {
    const period = url.searchParams.get("period") || "live";
    if (!RANKING_PERIODS[period]) {
      return json({ error: "Invalid period. Use live, week, month, or year." }, 400);
    }

    try {
      return json(
        await getSocialFeed(env, period, url.origin, fetchImpl),
        200,
        { "cache-control": "public, max-age=60, s-maxage=300" }
      );
    } catch (error) {
      console.error("GET /api/social/feed failed:", error);
      return json({ error: "Database unavailable" }, 503);
    }
  }

  if (path === "/api/search") {
    let q: string;
    try {
      q = parseSearch(url.searchParams.get("q"));
    } catch (error) {
      return json({
        error: error instanceof Error && error.message === "Search query too long"
          ? "Invalid q parameter. Maximum length is 100 characters."
          : "Missing q parameter"
      }, 400);
    }

    try {
      return json({ query: q, data: await searchGames(env, q, fetchImpl) }, 200, {
        "cache-control": "public, max-age=30, s-maxage=60"
      });
    } catch (error) {
      console.error("GET /api/search failed:", error);
      return json({ error: "Database unavailable" }, 503);
    }
  }

  return json({ error: "Not found" }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const startedAt = performance.now();
    const response = request.method === "OPTIONS"
      ? new Response(null, { status: 204, headers: { ...corsHeaders() } })
      : request.method !== "GET"
        ? json({ error: "Method not allowed" }, 405, { allow: "GET, OPTIONS" })
        : await handleApi(request, env);

    const headers = new Headers(response.headers);
    headers.set("server-timing", "api;dur=" + (performance.now() - startedAt).toFixed(1));
    const timedResponse = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });

    recordApiAnalytics(env, request, timedResponse);
    return withCors(timedResponse);
  }
};

export { handleApi };

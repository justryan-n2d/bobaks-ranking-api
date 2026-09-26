interface Env {
  SUPABASE_URL: string;
  SUPABASE_SECRET_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  ROBLOX_REQUEST_TIMEOUT_MS?: string;
  ROBLOX_THROTTLE_MS?: string;
}

type Json = Record<string, unknown>;
type FetchLike = typeof fetch;

interface ScheduledController {
  cron: string;
  scheduledTime: number;
}

interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

const ROBLOX_OFFICIAL_BASE = 'https://apis.roblox.com';
const ROBLOX_OFFICIAL_GAMES = 'https://games.roblox.com/v1/games';
const ROBLOX_PROXY_BASE = 'https://apis.roproxy.com';
const ROBLOX_PROXY_GAMES = 'https://games.roproxy.com/v1/games';
const ROBLOX_OFFICIAL_ICONS = 'https://thumbnails.roblox.com/v1/games/icons';
const ROBLOX_PROXY_ICONS = 'https://thumbnails.roproxy.com/v1/games/icons';
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_THROTTLE_MS = 150;

function requiredSupabaseKey(env: Env): string {
  const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('Missing SUPABASE_SECRET_KEY');
  return key;
}

function intEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

async function robloxJson(url: string, fetchImpl: FetchLike, env: Env): Promise<Json> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), intEnv(env.ROBLOX_REQUEST_TIMEOUT_MS, DEFAULT_TIMEOUT_MS));
  try {
    const response = await fetchImpl(url, { headers: { 'User-Agent': 'BobaksRanking/2.0' }, signal: controller.signal });
    if (!response.ok) throw new Error(`Roblox HTTP ${response.status}`);
    return (await response.json()) as Json;
  } finally {
    clearTimeout(timeout);
  }
}

async function robloxJsonWithFallback(officialUrl: string, proxyUrl: string, fetchImpl: FetchLike, env: Env): Promise<Json> {
  try {
    return await robloxJson(officialUrl, fetchImpl, env);
  } catch (officialError) {
    console.warn('Roblox official endpoint failed, trying proxy:', officialError);
    return await robloxJson(proxyUrl, fetchImpl, env);
  }
}

function extractUniverseIds(value: unknown, output = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) extractUniverseIds(item, output);
    return output;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (/universeId/i.test(key) && (typeof child === 'number' || typeof child === 'string')) {
        const id = String(child);
        if (/^\d+$/.test(id)) output.add(id);
      }
      extractUniverseIds(child, output);
    }
  }
  return output;
}

async function discoverUniverseIds(fetchImpl: FetchLike, env: Env): Promise<string[]> {
  const sessionId = crypto.randomUUID();
  const sortsUrl = `${ROBLOX_OFFICIAL_BASE}/explore-api/v1/get-sorts?sessionId=${sessionId}&device=computer&country=all`;
  const proxySortsUrl = `${ROBLOX_PROXY_BASE}/explore-api/v1/get-sorts?sessionId=${sessionId}&device=computer&country=all`;
  const sorts = await robloxJsonWithFallback(sortsUrl, proxySortsUrl, fetchImpl, env);
  const sortList = Array.isArray(sorts.sorts) ? sorts.sorts : [];
  const preferred = new Set(['top-playing-now', 'top-rated', 'top-grossing', 'up-and-coming']);
  const ids = new Set<string>();

  for (const rawSort of sortList) {
    if (!rawSort || typeof rawSort !== 'object') continue;
    const sort = rawSort as Record<string, unknown>;
    const sortId = String(sort.sortId ?? sort.id ?? '');
    if (!sortId) continue;
    const name = String(sort.name ?? sort.sortDisplayName ?? sortId).toLowerCase();
    if (preferred.size && !preferred.has(sortId) && !name.includes('playing') && !name.includes('popular')) continue;

    const official = `${ROBLOX_OFFICIAL_BASE}/explore-api/v1/get-sort-content?sessionId=${sessionId}&sortId=${encodeURIComponent(sortId)}&device=computer&country=all&maxRows=100`;
    const proxy = `${ROBLOX_PROXY_BASE}/explore-api/v1/get-sort-content?sessionId=${sessionId}&sortId=${encodeURIComponent(sortId)}&device=computer&country=all&maxRows=100`;
    try {
      const content = await robloxJsonWithFallback(official, proxy, fetchImpl, env);
      for (const id of extractUniverseIds(content)) ids.add(id);
    } catch (error) {
      console.warn(`Could not read Roblox sort ${sortId}:`, error);
    }
  }

  if (!ids.size) throw new Error('Roblox discovery returned no universe IDs');
  return [...ids].slice(0, 300);
}

async function getUniverseInfo(universeIds: string[], fetchImpl: FetchLike, env: Env): Promise<Array<Record<string, unknown>>> {
  const result: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  for (let i = 0; i < universeIds.length; i += 10) {
    const batch = universeIds.slice(i, i + 10);
    const query = batch.join(',');
    const official = `${ROBLOX_OFFICIAL_GAMES}?universeIds=${query}`;
    const proxy = `${ROBLOX_PROXY_GAMES}?universeIds=${query}`;
    const response = await robloxJsonWithFallback(official, proxy, fetchImpl, env);
    if (!Array.isArray(response.data)) throw new Error('Roblox universe info response had invalid data');
    for (const item of response.data) {
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      const id = String(row.id ?? row.universeId ?? '');
      if (!/^\d+$/.test(id) || id === '0' || seen.has(id)) continue;
      seen.add(id);
      result.push(row);
    }
    const throttle = intEnv(env.ROBLOX_THROTTLE_MS, DEFAULT_THROTTLE_MS);
    if (throttle) await new Promise(resolve => setTimeout(resolve, throttle));
  }
  return result;
}

async function getUniverseThumbnails(universeIds: string[], fetchImpl: FetchLike, env: Env): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  for (let i = 0; i < universeIds.length; i += 100) {
    const batch = universeIds.slice(i, i + 100);
    if (!batch.length) continue;
    const params = `?universeIds=${encodeURIComponent(batch.join(','))}&returnPolicy=PlaceHolder&size=150x150&format=Png&isCircular=false`;
    const fetchThumbnail = async (url: string): Promise<Json | null> => {
      try {
        return await robloxJson(url, fetchImpl, env);
      } catch (error) {
        console.warn('Roblox thumbnail endpoint failed:', error);
        return null;
      }
    };
    const response = (await fetchThumbnail(ROBLOX_OFFICIAL_ICONS + params)) ?? (await fetchThumbnail(ROBLOX_PROXY_ICONS + params));
    const data = Array.isArray(response?.data) ? response.data : [];
    for (const item of data) {
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      const id = String(row.targetId ?? '');
      const imageUrl = String(row.imageUrl ?? '').trim();
      if (/^\d+$/.test(id) && imageUrl) result.set(id, imageUrl);
    }
  }
  return result;
}

function parsePlayerCount(value: unknown): number {
  const count = Number(value);
  return Number.isFinite(count) ? Math.max(0, Math.round(count)) : 0;
}

function parseDate(value: unknown): string | null {
  if (value == null || value === '') return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function supabaseRequest(env: Env, path: string, fetchImpl: FetchLike, init: RequestInit = {}): Promise<Response> {
  const key = requiredSupabaseKey(env);
  const base = env.SUPABASE_URL.replace(/\/$/, '');
  const headers = new Headers(init.headers);
  headers.set('apikey', key);
  headers.delete('Authorization');
  if (!key.startsWith('sb_')) {
    headers.set('Authorization', `Bearer ${key}`);
  }
  headers.set('Content-Type', 'application/json');
  return await fetchImpl(`${base}/rest/v1/${path}`, { ...init, headers });
}

async function expectOk(response: Response, label: string): Promise<string> {
  const body = await response.text();
  if (!response.ok) throw new Error(`${label} HTTP ${response.status}: ${body.slice(0, 500)}`);
  return body;
}

async function upsertGames(env: Env, rows: Array<Record<string, unknown>>, fetchImpl: FetchLike): Promise<Array<{ id: string; universeId: string }>> {
  const result: Array<{ id: string; universeId: string }> = [];
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100);
    const response = await supabaseRequest(env, 'Game?on_conflict=universeId', fetchImpl, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(batch)
    });
    const body = await expectOk(response, 'Game upsert');
    const data = JSON.parse(body) as Array<Record<string, unknown>>;
    for (const row of data) result.push({ id: String(row.id), universeId: String(row.universeId) });
  }
  return result;
}

async function insertSnapshots(env: Env, rows: Array<Record<string, unknown>>, fetchImpl: FetchLike): Promise<void> {
  if (!rows.length) return;
  for (let i = 0; i < rows.length; i += 500) {
    const response = await supabaseRequest(env, 'GameSnapshot', fetchImpl, {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(rows.slice(i, i + 500))
    });
    await expectOk(response, 'GameSnapshot insert');
  }
}

async function recordPeaks(env: Env, rows: Array<Record<string, unknown>>, fetchImpl: FetchLike): Promise<void> {
  if (!rows.length) return;
  const response = await supabaseRequest(env, 'rpc/record_game_peaks', fetchImpl, {
    method: 'POST',
    body: JSON.stringify({ p_rows: rows })
  });
  await expectOk(response, 'record_game_peaks');
}

async function refreshRankings(env: Env, fetchImpl: FetchLike): Promise<void> {
  const response = await supabaseRequest(env, 'rpc/refresh_rankings', fetchImpl, {
    method: 'POST',
    body: JSON.stringify({})
  });
  await expectOk(response, 'refresh_rankings');
}

export async function summarizeYesterday(env: Env, fetchImpl: FetchLike = fetch): Promise<number> {
  requiredSupabaseKey(env);
  const response = await supabaseRequest(env, 'rpc/summarize_yesterday_daily_game_stats', fetchImpl, {
    method: 'POST',
    body: JSON.stringify({})
  });
  const body = await expectOk(response, 'summarize_yesterday_daily_game_stats');
  if (!body.trim()) return 0;

  const result = JSON.parse(body) as unknown;
  const count = Number(result);
  if (!Number.isFinite(count) || count < 0) {
    throw new Error('summarize_yesterday_daily_game_stats returned an invalid count');
  }
  return Math.floor(count);
}

async function writeLog(env: Env, row: Record<string, unknown>, fetchImpl: FetchLike): Promise<void> {
  const response = await supabaseRequest(env, 'DataCollectionLog', fetchImpl, {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(row)
  });
  await expectOk(response, 'DataCollectionLog insert');
}

export async function collectOnce(env: Env, fetchImpl: FetchLike = fetch): Promise<{ gamesChecked: number; gamesUpdated: number; errors: number }> {
  requiredSupabaseKey(env);
  const startedAt = new Date();
  let gamesChecked = 0;
  let gamesUpdated = 0;
  let errors = 0;

  try {
    const universeIds = await discoverUniverseIds(fetchImpl, env);
    const infos = await getUniverseInfo(universeIds, fetchImpl, env);
    const iconMap = await getUniverseThumbnails(
      infos.map(info => String(info.id ?? info.universeId ?? '')).filter(id => /^\d+$/.test(id)),
      fetchImpl,
      env
    );
    gamesChecked = infos.length;

    const now = new Date().toISOString();
    const gamePayloads = infos.flatMap(info => {
      const universeId = String(info.id ?? info.universeId ?? '');
      if (!/^\d+$/.test(universeId)) {
        errors++;
        return [];
      }

      const creator = info.creator && typeof info.creator === 'object'
        ? info.creator as Record<string, unknown>
        : null;

      return [{
        universeId,
        placeId: info.rootPlaceId == null ? null : String(info.rootPlaceId),
        name: String(info.name ?? 'Unknown Game'),
        creatorName: creator ? String(creator.name ?? '') || null : null,
        creatorId: creator?.id == null ? null : String(creator.id),
        iconUrl: iconMap.get(universeId) ?? null,
        description: info.description == null ? null : String(info.description),
        createdAt: parseDate(info.created),
        updatedAt: parseDate(info.updated),
        isActive: true
      }];
    });

    const games = await upsertGames(env, gamePayloads, fetchImpl);
    const byUniverse = new Map(games.map(game => [game.universeId, game.id]));
    const snapshots: Array<Record<string, unknown>> = [];
    const peaks: Array<Record<string, unknown>> = [];

    for (const info of infos) {
      const universeId = String(info.id ?? info.universeId ?? '');
      const gameId = byUniverse.get(universeId);
      if (!gameId) {
        errors++;
        continue;
      }

      const playerCount = parsePlayerCount(info.playing);
      snapshots.push({ gameId, playerCount, timestamp: now });
      peaks.push({ gameId, playerCount, peakAt: now });
      gamesUpdated++;
    }

    await insertSnapshots(env, snapshots, fetchImpl);
    await recordPeaks(env, peaks, fetchImpl);
    await refreshRankings(env, fetchImpl);

    await writeLog(env, {
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      gamesChecked,
      gamesUpdated,
      errors,
      status: errors ? 'partial' : 'success'
    }, fetchImpl);

    return { gamesChecked, gamesUpdated, errors };
  } catch (error) {
    errors++;
    console.error('Collector failed:', error);

    try {
      await writeLog(env, {
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        gamesChecked,
        gamesUpdated,
        errors,
        status: 'failed'
      }, fetchImpl);
    } catch (logError) {
      console.error('Failed to record collector failure:', logError);
    }

    throw error;
  }
}

async function runDailySummary(env: Env, fetchImpl: FetchLike = fetch): Promise<number> {
  const startedAt = new Date();
  let gamesUpdated = 0;

  try {
    gamesUpdated = await summarizeYesterday(env, fetchImpl);

    await writeLog(env, {
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      gamesChecked: gamesUpdated,
      gamesUpdated,
      errors: 0,
      status: 'daily_summary_success'
    }, fetchImpl);

    return gamesUpdated;
  } catch (error) {
    console.error('Daily summary failed:', error);

    try {
      await writeLog(env, {
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        gamesChecked: gamesUpdated,
        gamesUpdated,
        errors: 1,
        status: 'daily_summary_failed'
      }, fetchImpl);
    } catch (logError) {
      console.error('Failed to record daily summary failure:', logError);
    }

    throw error;
  }
}

export async function scheduledForTest(
  controller: ScheduledController,
  env: Env,
  fetchImpl: FetchLike = fetch
): Promise<void> {
  if (controller.cron === '5 0 * * *') {
    await runDailySummary(env, fetchImpl);
    return;
  }

  await collectOnce(env, fetchImpl);
}

export async function scheduled(
  controller: ScheduledController,
  env: Env,
  _ctx: WorkerExecutionContext
): Promise<void> {
  await scheduledForTest(controller, env, fetch);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      const databaseConfigured = Boolean(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY);
      let supabaseAuthOk = false;
      let supabaseStatus: number | null = null;

      if (databaseConfigured) {
        try {
          const response = await supabaseRequest(
            env,
            'Game?select=id&limit=1',
            fetch,
            { method: 'GET' }
          );
          supabaseStatus = response.status;
          supabaseAuthOk = response.ok;
        } catch {
          supabaseStatus = null;
        }
      }

      return Response.json({
        ok: true,
        service: 'bobaks-ranking-collector',
        platform: 'cloudflare-workers',
        crons: ['*/10 * * * *', '5 0 * * *'],
        databaseConfigured,
        supabaseAuthOk,
        supabaseStatus,
        timestamp: new Date().toISOString()
      });
    }

    return new Response('Not found', { status: 404 });
  },

  scheduled
};

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
const ROBLOX_DEVELOP_UNIVERSES = 'https://develop.roblox.com/v1/universes';
const ROBLOX_OFFICIAL_ICONS = 'https://thumbnails.roblox.com/v1/games/icons';
const ROBLOX_PROXY_ICONS = 'https://thumbnails.roproxy.com/v1/games/icons';
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_THROTTLE_MS = 150;
const ROBLOX_RETRY_ATTEMPTS = 3;
const ROBLOX_RETRY_DELAYS_MS = [500, 1000];
const ROBLOX_MAX_RETRY_AFTER_MS = 15000;

function retryDelayMs(response: Response, attempt: number): number {
  const retryAfter = response.headers.get('Retry-After');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(Math.floor(seconds * 1000), ROBLOX_MAX_RETRY_AFTER_MS);
    }

    const retryAt = Date.parse(retryAfter);
    if (Number.isFinite(retryAt)) {
      return Math.max(
        0,
        Math.min(retryAt - Date.now(), ROBLOX_MAX_RETRY_AFTER_MS)
      );
    }
  }

  return Math.min(
    ROBLOX_RETRY_DELAYS_MS[attempt - 1] ?? 2000,
    ROBLOX_MAX_RETRY_AFTER_MS
  );
}

function requiredSupabaseKey(env: Env): string {
  const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('Missing SUPABASE_SECRET_KEY');
  return key;
}

function intEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function isRetryableRobloxError(error: unknown): boolean {
  const message = String(error instanceof Error ? error.message : error).toLowerCase();
  return (
    message.includes('failed to fetch') ||
    message.includes('network') ||
    message.includes('timeout') ||
    /^roblox http 5\d\d$/.test(message)
  );
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function robloxJson(url: string, fetchImpl: FetchLike, env: Env): Promise<Json> {
  for (let attempt = 1; attempt <= ROBLOX_RETRY_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), intEnv(env.ROBLOX_REQUEST_TIMEOUT_MS, DEFAULT_TIMEOUT_MS));

    try {
      const response = await fetchImpl(url, {
        headers: { 'User-Agent': 'BobaksRanking/2.0' },
        signal: controller.signal
      });

      if (response.ok) {
        return (await response.json()) as Json;
      }

      if (response.status === 429 && attempt < ROBLOX_RETRY_ATTEMPTS) {
        const delay = retryDelayMs(response, attempt);
        console.warn(
          `Roblox HTTP 429 (attempt ${attempt}/${ROBLOX_RETRY_ATTEMPTS}), retrying in ${delay}ms`
        );
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      throw new Error(`Roblox HTTP ${response.status}`);
    } catch (error) {
      if (attempt === ROBLOX_RETRY_ATTEMPTS || !isRetryableRobloxError(error)) {
        throw error;
      }

      const delay = Math.min(
        ROBLOX_RETRY_DELAYS_MS[attempt - 1] ?? 1000,
        ROBLOX_MAX_RETRY_AFTER_MS
      );
      console.warn(`Roblox request failed (attempt ${attempt}/${ROBLOX_RETRY_ATTEMPTS}), retrying in ${delay}ms:`, error);
      await new Promise(resolve => setTimeout(resolve, delay));
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error('Roblox request exhausted retry attempts');
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

async function getUniverseThumbnails(
  games: Array<{ universeId: string; placeId: string | null }>,
  fetchImpl: FetchLike,
  env: Env
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const universeIds = [...new Set(games.map(game => game.universeId).filter(id => /^\d+$/.test(id)))];

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

    let response = await fetchThumbnail(ROBLOX_OFFICIAL_ICONS + params);
    let data = Array.isArray(response?.data) ? response.data : [];

    // If the official endpoint succeeds but filters a universe out,
    // try the proxy instead of treating an empty result as final.
    if (!data.length) {
      response = await fetchThumbnail(ROBLOX_PROXY_ICONS + params);
      data = Array.isArray(response?.data) ? response.data : [];
    }

    for (const item of data) {
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      const id = String(row.targetId ?? '');
      const imageUrl = String(row.imageUrl ?? '').trim();
      if (/^\d+$/.test(id) && imageUrl) result.set(id, imageUrl);
    }
  }

  const missing = games.filter(game => !result.has(game.universeId) && game.placeId);
  const placeToUniverse = new Map(
    missing.map(game => [String(game.placeId), game.universeId])
  );
  const placeIds = [...placeToUniverse.keys()];

  for (let i = 0; i < placeIds.length; i += 100) {
    const batch = placeIds.slice(i, i + 100);
    if (!batch.length) continue;

    const params = `?placeIds=${encodeURIComponent(batch.join(','))}&returnPolicy=PlaceHolder&size=150x150&format=Png&isCircular=false`;
    const fetchPlaceIcons = async (url: string): Promise<Json | null> => {
      try {
        return await robloxJson(url, fetchImpl, env);
      } catch (error) {
        console.warn('Roblox place icon endpoint failed:', error);
        return null;
      }
    };

    let response = await fetchPlaceIcons('https://thumbnails.roblox.com/v1/places/gameicons' + params);
    let data = Array.isArray(response?.data) ? response.data : [];

    if (!data.length) {
      response = await fetchPlaceIcons('https://thumbnails.roproxy.com/v1/places/gameicons' + params);
      data = Array.isArray(response?.data) ? response.data : [];
    }

    for (const item of data) {
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      const placeId = String(row.targetId ?? '');
      const imageUrl = String(row.imageUrl ?? '').trim();
      const universeId = placeToUniverse.get(placeId);
      if (universeId && imageUrl) result.set(universeId, imageUrl);
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

async function listStaleActiveGames(
  env: Env,
  cutoff: string,
  fetchImpl: FetchLike
): Promise<Array<{ id: string; universeId: string }>> {
  const response = await supabaseRequest(env, 'rpc/list_stale_active_games', fetchImpl, {
    method: 'POST',
    body: JSON.stringify({
      p_cutoff: cutoff,
      p_limit: 100
    })
  });
  const body = await expectOk(response, 'Stale game lookup');
  if (!body.trim()) return [];

  const data = JSON.parse(body) as unknown;
  if (!Array.isArray(data)) {
    throw new Error('Stale game lookup returned invalid data');
  }

  return data.flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    const id = String(row.id ?? '');
    const universeId = String(row.universeId ?? '');
    if (!/^\d+$/.test(id) || !/^\d+$/.test(universeId)) return [];
    return [{ id, universeId }];
  });
}

interface VerificationPresenceResult {
  foundUniverseIds: string[];
  confirmedMissingUniverseIds: string[];
  uncertainUniverseIds: string[];
}

function universeIdsFromInfo(infos: Array<Record<string, unknown>>): Set<string> {
  return new Set(
    infos
      .map(info => String(info.id ?? info.universeId ?? ''))
      .filter(id => /^\d+$/.test(id))
  );
}

async function getVerificationInfo(
  universeIds: string[],
  fetchImpl: FetchLike,
  env: Env,
  baseUrl: string
): Promise<{ found: Set<string>; requestFailed: boolean }> {
  const found = new Set<string>();
  let requestFailed = false;

  for (let i = 0; i < universeIds.length; i += 10) {
    const batch = universeIds.slice(i, i + 10);
    const query = batch.join(',');

    try {
      const response = await robloxJson(`${baseUrl}?universeIds=${query}`, fetchImpl, env);
      if (!Array.isArray(response.data)) {
        requestFailed = true;
      } else {
        for (const id of universeIdsFromInfo(response.data as Array<Record<string, unknown>>)) {
          found.add(id);
        }
      }
    } catch (error) {
      requestFailed = true;
      console.warn(`Roblox verification source failed: ${baseUrl}`, error);
    }

    const throttle = intEnv(env.ROBLOX_THROTTLE_MS, DEFAULT_THROTTLE_MS);
    if (throttle && i + 10 < universeIds.length) {
      await new Promise(resolve => setTimeout(resolve, throttle));
    }
  }

  return { found, requestFailed };
}

async function getVerificationThumbnailIds(
  universeIds: string[],
  fetchImpl: FetchLike,
  env: Env,
  baseUrl: string
): Promise<{ found: Set<string>; requestFailed: boolean }> {
  const found = new Set<string>();
  let requestFailed = false;

  for (let i = 0; i < universeIds.length; i += 100) {
    const batch = universeIds.slice(i, i + 100);
    if (!batch.length) continue;

    const params = `?universeIds=${encodeURIComponent(batch.join(','))}&returnPolicy=PlaceHolder&size=150x150&format=Png&isCircular=false`;

    try {
      const response = await robloxJson(`${baseUrl}${params}`, fetchImpl, env);
      if (!Array.isArray(response.data)) {
        requestFailed = true;
        continue;
      }

      for (const item of response.data) {
        if (!item || typeof item !== 'object') continue;
        const row = item as Record<string, unknown>;
        const id = String(row.targetId ?? '');
        if (/^\d+$/.test(id) && universeIds.includes(id)) {
          found.add(id);
        }
      }
    } catch (error) {
      requestFailed = true;
      console.warn(`Roblox verification thumbnail source failed: ${baseUrl}`, error);
    }
  }

  return { found, requestFailed };
}

async function probeVerificationUniverse(
  universeId: string,
  fetchImpl: FetchLike,
  env: Env
): Promise<'found' | 'missing' | 'uncertain'> {
  try {
    const response = await robloxJson(`${ROBLOX_DEVELOP_UNIVERSES}/${encodeURIComponent(universeId)}`, fetchImpl, env);
    if (!response || typeof response !== 'object') return 'uncertain';
    return 'found';
  } catch (error) {
    const message = formatError(error);
    if (message.includes('Roblox HTTP 404')) return 'missing';
    console.warn(`Roblox universe existence probe failed for ${universeId}:`, error);
    return 'uncertain';
  }
}

async function verifyUniversePresence(
  universeIds: string[],
  fetchImpl: FetchLike,
  env: Env
): Promise<VerificationPresenceResult> {
  const found = new Set<string>();

  const officialGames = await getVerificationInfo(
    universeIds,
    fetchImpl,
    env,
    ROBLOX_OFFICIAL_GAMES
  );
  const proxyGames = await getVerificationInfo(
    universeIds,
    fetchImpl,
    env,
    ROBLOX_PROXY_GAMES
  );

  for (const id of officialGames.found) found.add(id);
  for (const id of proxyGames.found) found.add(id);

  let unresolved = universeIds.filter(id => !found.has(id));

  if (unresolved.length) {
    const officialThumbs = await getVerificationThumbnailIds(
      unresolved,
      fetchImpl,
      env,
      ROBLOX_OFFICIAL_ICONS
    );
    const proxyThumbs = await getVerificationThumbnailIds(
      unresolved,
      fetchImpl,
      env,
      ROBLOX_PROXY_ICONS
    );

    for (const id of officialThumbs.found) found.add(id);
    for (const id of proxyThumbs.found) found.add(id);
  }

  unresolved = universeIds.filter(id => !found.has(id));
  const confirmedMissingUniverseIds: string[] = [];
  const uncertainUniverseIds: string[] = [];

  for (const id of unresolved) {
    const probe = await probeVerificationUniverse(id, fetchImpl, env);
    if (probe === 'found') {
      found.add(id);
    } else if (probe === 'missing') {
      confirmedMissingUniverseIds.push(id);
    } else {
      uncertainUniverseIds.push(id);
    }
  }

  return {
    foundUniverseIds: [...found],
    confirmedMissingUniverseIds,
    uncertainUniverseIds
  };
}

async function verifyStaleGames(
  env: Env,
  fetchImpl: FetchLike,
  cutoff: string,
  verifiedAt: string
): Promise<number> {
  const candidates = await listStaleActiveGames(env, cutoff, fetchImpl);
  if (!candidates.length) return 0;

  const attemptedUniverseIds = candidates.map(game => game.universeId);
  const presence = await verifyUniversePresence(attemptedUniverseIds, fetchImpl, env);

  if (presence.uncertainUniverseIds.length) {
    console.warn(
      `Skipping miss increments for ${presence.uncertainUniverseIds.length} stale games because Roblox verification was inconclusive.`
    );
  }

  const classifiedCount =
    presence.foundUniverseIds.length +
    presence.confirmedMissingUniverseIds.length +
    presence.uncertainUniverseIds.length;

  if (classifiedCount !== attemptedUniverseIds.length) {
    throw new Error('Roblox verification classification did not cover every attempted universe');
  }

  const response = await supabaseRequest(env, 'rpc/verify_game_activity', fetchImpl, {
    method: 'POST',
    body: JSON.stringify({
      p_attempted_universe_ids: attemptedUniverseIds,
      p_found_universe_ids: presence.foundUniverseIds,
      p_confirmed_missing_universe_ids: presence.confirmedMissingUniverseIds,
      p_uncertain_universe_ids: presence.uncertainUniverseIds,
      p_verified_at: verifiedAt
    })
  });
  const body = await expectOk(response, 'verify_game_activity');
  if (!body.trim()) return 0;

  const processed = Number(body);
  if (!Number.isFinite(processed) || processed < 0) {
    throw new Error('verify_game_activity returned an invalid count');
  }
  return Math.floor(processed);
}

async function writeLog(env: Env, row: Record<string, unknown>, fetchImpl: FetchLike): Promise<void> {
  const response = await supabaseRequest(env, 'DataCollectionLog', fetchImpl, {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(row)
  });
  await expectOk(response, 'DataCollectionLog insert');
}

async function updateRankingRefreshLog(
  env: Env,
  collectionRunId: string,
  fields: Record<string, unknown>,
  fetchImpl: FetchLike
): Promise<void> {
  const path = 'DataCollectionLog?collectionRunId=eq.' + encodeURIComponent(collectionRunId);
  const response = await supabaseRequest(
    env,
    path,
    fetchImpl,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(fields)
    }
  );
  await expectOk(response, 'DataCollectionLog ranking refresh update');
}

export async function collectOnce(env: Env, fetchImpl: FetchLike = fetch): Promise<{ gamesChecked: number; gamesUpdated: number; errors: number }> {
  requiredSupabaseKey(env);
  const startedAt = new Date();
  const collectionRunId = crypto.randomUUID();
  let gamesChecked = 0;
  let gamesUpdated = 0;
  let errors = 0;
  let collectionLogWritten = false;

  try {
    const universeIds = await discoverUniverseIds(fetchImpl, env);
    const infos = await getUniverseInfo(universeIds, fetchImpl, env);
    const iconMap = await getUniverseThumbnails(
      infos
        .map(info => ({
          universeId: String(info.id ?? info.universeId ?? ''),
          placeId: info.rootPlaceId == null ? null : String(info.rootPlaceId)
        }))
        .filter(game => /^\d+$/.test(game.universeId)),
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

      const row: Record<string, unknown> = {
        universeId,
        placeId: info.rootPlaceId == null ? null : String(info.rootPlaceId),
        name: String(info.name ?? 'Unknown Game'),
        creatorName: creator ? String(creator.name ?? '') || null : null,
        creatorId: creator?.id == null ? null : String(creator.id),
        description: info.description == null ? null : String(info.description),
        createdAt: parseDate(info.created),
        updatedAt: parseDate(info.updated),
        isActive: true,
        lastObservedAt: now,
        lastVerificationAttemptAt: now,
        verificationMisses: 0,
        inactiveAt: null,
        inactiveReason: null
      };

      // Never erase a known-good icon just because Roblox returned no icon
      // in this collection cycle. A later successful cycle can refresh it.
      const iconUrl = iconMap.get(universeId);
      if (iconUrl) row.iconUrl = iconUrl;

      return [row];
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
      snapshots.push({ gameId, playerCount, timestamp: now, collectionRunId });
      peaks.push({ gameId, playerCount, peakAt: now });
      gamesUpdated++;
    }

    await insertSnapshots(env, snapshots, fetchImpl);
    await recordPeaks(env, peaks, fetchImpl);

    // Games missing from discovery are not immediately marked inactive.
    // Only games that have not been observed for 24 hours enter explicit
    // verification, and they need 12 consecutive misses before deactivation.
    try {
      await verifyStaleGames(
        env,
        fetchImpl,
        new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        new Date().toISOString()
      );
    } catch (verificationError) {
      // Verification is a secondary maintenance step. Do not turn a valid
      // collection run into a failed run just because verification is down.
      errors++;
      console.error('Game activity verification failed:', verificationError);
    }

    // Finalize the collection log before refreshing rankings so the current
    // run is visible in both the coverage denominator and snapshot validation.
    const rankingRefreshStartedAt = new Date().toISOString();
    await writeLog(env, {
      collectionRunId,
      startedAt: startedAt.toISOString(),
      finishedAt: rankingRefreshStartedAt,
      gamesChecked,
      gamesUpdated,
      errors,
      status: errors ? 'partial' : 'success',
      rankingRefreshStatus: 'pending',
      rankingRefreshStartedAt
    }, fetchImpl);
    collectionLogWritten = true;

    // Ranking refresh is downstream of data collection. If it fails, the
    // collected snapshots remain valid and the collection run stays usable.
    // The refresh result is recorded separately so an alert can distinguish
    // a healthy collection from a failed ranking publication.
    try {
      await refreshRankings(env, fetchImpl);
      await updateRankingRefreshLog(
        env,
        collectionRunId,
        {
          rankingRefreshStatus: 'success',
          rankingRefreshFinishedAt: new Date().toISOString(),
          rankingRefreshErrorMessage: null
        },
        fetchImpl
      );
    } catch (refreshError) {
      try {
        await updateRankingRefreshLog(
          env,
          collectionRunId,
          {
            rankingRefreshStatus: 'failed',
            rankingRefreshFinishedAt: new Date().toISOString(),
            rankingRefreshErrorMessage: formatError(refreshError).slice(0, 1000)
          },
          fetchImpl
        );
      } catch (logError) {
        console.error('Failed to record ranking refresh failure:', logError);
      }

      throw refreshError;
    }

    return { gamesChecked, gamesUpdated, errors };
  } catch (error) {
    errors++;
    console.error('Collector failed:', error);

    if (!collectionLogWritten) {
      try {
        await writeLog(env, {
          collectionRunId,
          startedAt: startedAt.toISOString(),
          finishedAt: new Date().toISOString(),
          gamesChecked,
          gamesUpdated,
          errors,
          status: 'failed',
          errorMessage: formatError(error)
        }, fetchImpl);
      } catch (logError) {
        console.error('Failed to record collector failure:', logError);
      }
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
        status: 'daily_summary_failed',
        errorMessage: formatError(error)
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

const COLLECTION_HEALTH_THRESHOLD_SECONDS = 15 * 60;

export async function collectorHealth(env: Env, fetchImpl: FetchLike = fetch): Promise<Record<string, unknown>> {
  const databaseConfigured = Boolean(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY);
  let supabaseAuthOk = false;
  let supabaseStatus: number | null = null;

  if (!databaseConfigured) {
    return {
      ok: false,
      status: 'unhealthy',
      service: 'bobaks-ranking-collector',
      platform: 'cloudflare-workers',
      crons: ['*/10 * * * *', '5 0 * * *'],
      databaseConfigured: false,
      supabaseAuthOk: false,
      supabaseStatus: null,
      collection: {
        status: 'unhealthy',
        latestStatus: null,
        latestStartedAt: null,
        lastGoodStartedAt: null,
        ageSeconds: null,
        freshnessThresholdSeconds: COLLECTION_HEALTH_THRESHOLD_SECONDS
      },
      timestamp: new Date().toISOString()
    };
  }

  try {
    const [dbCheck, latestRows, goodRows] = await Promise.all([
      supabaseRequest(env, 'Game?select=id&limit=1', fetchImpl, { method: 'GET' }),
      supabaseRequest(
        env,
        'DataCollectionLog?select=startedAt,finishedAt,status,gamesChecked,gamesUpdated,errors&status=in.(success,partial,failed)&order=startedAt.desc&limit=1',
        fetchImpl,
        { method: 'GET' }
      ),
      supabaseRequest(
        env,
        'DataCollectionLog?select=startedAt,finishedAt,status,gamesChecked,gamesUpdated,errors&status=in.(success,partial)&order=startedAt.desc&limit=1',
        fetchImpl,
        { method: 'GET' }
      )
    ]);

    supabaseStatus = dbCheck.status;
    supabaseAuthOk = dbCheck.ok;
    if (!dbCheck.ok) {
      return {
        ok: false,
        status: 'unhealthy',
        service: 'bobaks-ranking-collector',
        platform: 'cloudflare-workers',
        crons: ['*/10 * * * *', '5 0 * * *'],
        databaseConfigured,
        supabaseAuthOk,
        supabaseStatus,
        collection: {
          status: 'unhealthy',
          latestStatus: null,
          latestStartedAt: null,
          lastGoodStartedAt: null,
          ageSeconds: null,
          freshnessThresholdSeconds: COLLECTION_HEALTH_THRESHOLD_SECONDS
        },
        timestamp: new Date().toISOString()
      };
    }

    const latest = JSON.parse(await latestRows.text()) as Array<Record<string, unknown>>;
    const good = JSON.parse(await goodRows.text()) as Array<Record<string, unknown>>;
    const latestRow = latest[0] ?? {};
    const goodRow = good[0] ?? {};
    const latestStartedAt = String(latestRow.startedAt ?? '');
    const lastGoodStartedAt = String(goodRow.startedAt ?? '');
    const goodMs = Date.parse(lastGoodStartedAt);
    const ageSeconds = Number.isFinite(goodMs)
      ? Math.max(0, Math.floor((Date.now() - goodMs) / 1000))
      : null;
    const latestStatus = String(latestRow.status ?? 'unknown');

    const fresh = ageSeconds != null && ageSeconds <= COLLECTION_HEALTH_THRESHOLD_SECONDS;
    const collectionStatus =
      latestStatus === 'success' && fresh
        ? 'healthy'
        : fresh
          ? 'degraded'
          : 'unhealthy';

    return {
      ok: collectionStatus !== 'unhealthy',
      status: collectionStatus,
      service: 'bobaks-ranking-collector',
      platform: 'cloudflare-workers',
      crons: ['*/10 * * * *', '5 0 * * *'],
      databaseConfigured,
      supabaseAuthOk,
      supabaseStatus,
      collection: {
        status: collectionStatus,
        latestStatus: latestStatus === 'unknown' ? null : latestStatus,
        latestStartedAt: latestStartedAt || null,
        lastGoodStartedAt: lastGoodStartedAt || null,
        ageSeconds,
        freshnessThresholdSeconds: COLLECTION_HEALTH_THRESHOLD_SECONDS
      },
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return {
      ok: false,
      status: 'unhealthy',
      service: 'bobaks-ranking-collector',
      platform: 'cloudflare-workers',
      crons: ['*/10 * * * *', '5 0 * * *'],
      databaseConfigured,
      supabaseAuthOk,
      supabaseStatus,
      collection: {
        status: 'unhealthy',
        latestStatus: null,
        latestStartedAt: null,
        lastGoodStartedAt: null,
        ageSeconds: null,
        freshnessThresholdSeconds: COLLECTION_HEALTH_THRESHOLD_SECONDS
      },
      error: formatError(error),
      timestamp: new Date().toISOString()
    };
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      const body = await collectorHealth(env, fetch);
      return Response.json(body, { status: body.status === 'unhealthy' ? 503 : 200 });
    }

    return new Response('Not found', { status: 404 });
  },

  scheduled
};

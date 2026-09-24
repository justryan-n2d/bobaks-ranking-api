import { withDb, jsonSafe, type WorkerEnv } from './worker-db';

const PERIODS = new Set(['live', 'week', 'month', 'year']);
const PERIOD_DB: Record<string, string> = {
  live: 'live',
  week: 'weekly',
  month: 'monthly',
  year: 'yearly'
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

function json(data: unknown, status = 200): Response {
  return new Response(jsonSafe(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders }
  });
}

function errorResponse(message: string, status: number): Response {
  return json({ error: message }, status);
}

function getCollectorIntervalMinutes(env: WorkerEnv): number {
  const value = Number(env.COLLECTOR_INTERVAL_MINUTES || 10);
  return Number.isInteger(value) && value >= 1 && value <= 60 ? value : 10;
}

function gameFromRow(row: any) {
  return {
    id: row.id,
    universeId: row.universeId,
    placeId: row.placeId,
    name: row.name,
    creatorName: row.creatorName,
    creatorId: row.creatorId,
    iconUrl: row.iconUrl,
    description: row.description,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    isActive: row.isActive
  };
}

function safeDbDiagnosticCode(error: unknown): string {
  if (!error || typeof error !== 'object') return 'DB_UNKNOWN_ERROR';
  const code = 'code' in error && typeof error.code === 'string' ? error.code : '';
  const message = 'message' in error && typeof error.message === 'string' ? error.message.toLowerCase() : '';
  if (code === '28P01' || message.includes('password authentication failed')) return 'DB_AUTH_FAILED';
  if (code === '3D000' || message.includes('database') && message.includes('does not exist')) return 'DB_DATABASE_NOT_FOUND';
  if (code === 'ENOTFOUND' || message.includes('getaddrinfo')) return 'DB_DNS_FAILED';
  if (code === 'ECONNREFUSED' || message.includes('connection refused')) return 'DB_CONNECTION_REFUSED';
  if (code === 'ETIMEDOUT' || message.includes('timeout')) return 'DB_CONNECTION_TIMEOUT';
  if (code === 'ECONNRESET' || message.includes('connection reset')) return 'DB_CONNECTION_RESET';
  if (message.includes('certificate') || message.includes('ssl')) return 'DB_TLS_FAILED';
  return 'DB_CONNECTION_FAILED';
}

async function handleHealth(env: WorkerEnv): Promise<Response> {
  try {
    await withDb(env, async client => {
      await client.query('SELECT 1');
    });
    return json({
      ok: true,
      service: 'bobaks-ranking-api',
      database: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    const diagnosticCode = safeDbDiagnosticCode(error);
    console.error('health database check failed', {
      diagnosticCode,
      error: error instanceof Error ? error.message : String(error),
      code: typeof error === 'object' && error !== null && 'code' in error ? (error as { code?: unknown }).code : undefined
    });
    return json({
      ok: false,
      service: 'bobaks-ranking-api',
      database: 'unavailable',
      diagnosticCode,
      timestamp: new Date().toISOString()
    }, 503);
  }
}

async function handleRankings(request: Request, env: WorkerEnv): Promise<Response> {
  const url = new URL(request.url);
  const period = url.searchParams.get('period') || 'live';
  if (!PERIODS.has(period)) return errorResponse('Invalid period. Use live, week, month, or year.', 400);
  try {
    const rows = await withDb(env, async client => {
      const result = await client.query(`SELECT r.id, r."gameId", r.period, r.rank, r.score, r."calculatedAt", json_build_object('id', g.id, 'universeId', g."universeId", 'placeId', g."placeId", 'name', g.name, 'creatorName', g."creatorName", 'creatorId', g."creatorId", 'iconUrl', g."iconUrl", 'description', g.description, 'createdAt', g."createdAt", 'updatedAt', g."updatedAt", 'isActive', g."isActive") AS game FROM public."Ranking" r INNER JOIN public."Game" g ON g.id = r."gameId" WHERE r.period = $1 ORDER BY r.rank ASC LIMIT 100`, [PERIOD_DB[period]]);
      return result.rows;
    });
    const updatedAt = rows[0]?.calculatedAt ?? null;
    const refreshIntervalSeconds = getCollectorIntervalMinutes(env) * 60;
    const nextRefreshAt = updatedAt ? new Date(new Date(updatedAt).getTime() + refreshIntervalSeconds * 1000).toISOString() : null;
    return json({ period, updatedAt, refreshIntervalSeconds, nextRefreshAt, data: rows });
  } catch (error) {
    console.error('ranking query failed', error);
    return errorResponse('Database unavailable', 500);
  }
}

async function handleGames(request: Request, env: WorkerEnv, id?: string): Promise<Response> {
  try {
    if (id) {
      if (!/^\d+$/.test(id)) return errorResponse('Invalid game id', 400);
      const result = await withDb(env, client => client.query(`SELECT id, "universeId", "placeId", name, "creatorName", "creatorId", "iconUrl", description, "createdAt", "updatedAt", "isActive" FROM public."Game" WHERE id = $1 AND "isActive" = true LIMIT 1`, [id]));
      if (!result.rows[0]) return errorResponse('Game not found', 404);
      return json({ data: gameFromRow(result.rows[0]) });
    }
    const result = await withDb(env, client => client.query(`SELECT id, "universeId", "placeId", name, "creatorName", "creatorId", "iconUrl", description, "createdAt", "updatedAt", "isActive" FROM public."Game" WHERE "isActive" = true ORDER BY name ASC LIMIT 100`));
    return json({ data: result.rows.map(gameFromRow) });
  } catch (error) {
    console.error('game query failed', error);
    return errorResponse('Database unavailable', 500);
  }
}

async function handleHistory(request: Request, env: WorkerEnv, id: string): Promise<Response> {
  if (!/^\d+$/.test(id)) return errorResponse('Invalid game id', 400);
  const rawDays = new URL(request.url).searchParams.get('days');
  const days = rawDays == null || rawDays === '' ? 7 : Number(rawDays);
  if (!Number.isInteger(days) || days < 1 || days > 365) return errorResponse('Invalid days parameter. Use an integer from 1 to 365.', 400);
  try {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const result = await withDb(env, client => client.query(`SELECT id, "gameId", "playerCount", timestamp FROM public."GameSnapshot" WHERE "gameId" = $1 AND timestamp >= $2 ORDER BY timestamp ASC`, [id, since.toISOString()]));
    return json({ gameId: id, days, data: result.rows });
  } catch (error) {
    console.error('history query failed', error);
    return errorResponse('Database unavailable', 500);
  }
}

async function handlePeak(env: WorkerEnv, id: string): Promise<Response> {
  if (!/^\d+$/.test(id)) return errorResponse('Invalid game id', 400);
  try {
    const result = await withDb(env, client => client.query(`SELECT id, "gameId", "peakPlayers", "peakAt" FROM public."GamePeak" WHERE "gameId" = $1 LIMIT 1`, [id]));
    if (!result.rows[0]) return errorResponse('Peak not found', 404);
    return json({ data: result.rows[0] });
  } catch (error) {
    console.error('peak query failed', error);
    return errorResponse('Database unavailable', 500);
  }
}

async function handleSearch(request: Request, env: WorkerEnv): Promise<Response> {
  const q = (new URL(request.url).searchParams.get('q') || '').trim();
  if (!q) return errorResponse('Missing q parameter', 400);
  if (q.length > 100) return errorResponse('Invalid q parameter. Maximum length is 100 characters.', 400);
  try {
    const result = await withDb(env, client => client.query(`SELECT id, "universeId", "placeId", name, "creatorName", "creatorId", "iconUrl", description, "createdAt", "updatedAt", "isActive" FROM public."Game" WHERE "isActive" = true AND name ILIKE '%' || $1 || '%' ORDER BY name ASC LIMIT 50`, [q]));
    return json({ query: q, data: result.rows.map(gameFromRow) });
  } catch (error) {
    console.error('search query failed', error);
    return errorResponse('Database unavailable', 500);
  }
}

export async function handleApi(request: Request, env: WorkerEnv): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== 'GET') return errorResponse('Method not allowed', 405);
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (path === '/api/health') return handleHealth(env);
  if (path === '/api/rankings') return handleRankings(request, env);
  if (path === '/api/games') return handleGames(request, env);
  if (path === '/api/search') return handleSearch(request, env);
  const gameMatch = path.match(/^\/api\/games\/(\d+)(?:\/(history|peak))?$/);
  if (gameMatch) {
    const [, id, subroute] = gameMatch;
    if (subroute === 'history') return handleHistory(request, env, id);
    if (subroute === 'peak') return handlePeak(env, id);
    return handleGames(request, env, id);
  }
  return errorResponse('Not found', 404);
}

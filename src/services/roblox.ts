import crypto from "node:crypto";

const OFFICIAL_BASE = "https://apis.roblox.com";
const OFFICIAL_GAMES = "https://games.roblox.com/v1/games";
const PROXY_BASE = "https://apis.roproxy.com";
const PROXY_GAMES = "https://games.roproxy.com/v1/games";
const OFFICIAL_GAME_ICONS = "https://thumbnails.roblox.com/v1/games/icons";
const PROXY_GAME_ICONS = "https://thumbnails.roproxy.com/v1/games/icons";
const REQUEST_TIMEOUT_MS = 15000;

type Json = Record<string, unknown>;

async function getJson(url: string): Promise<Json> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "BobaksRanking/1.0" },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Roblox HTTP ${response.status} for ${url}`);
    }

    return (await response.json()) as Json;
  } finally {
    clearTimeout(timeout);
  }
}

function extractUniverseIds(value: unknown, output = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) extractUniverseIds(item, output);
    return output;
  }

  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (/universeId/i.test(key) && (typeof child === "number" || typeof child === "string")) {
        const id = String(child);
        if (/^\d+$/.test(id)) output.add(id);
      }
      extractUniverseIds(child, output);
    }
  }

  return output;
}

async function fetchWithFallback(officialUrl: string, proxyUrl: string): Promise<Json> {
  try {
    return await getJson(officialUrl);
  } catch (officialError) {
    console.warn("Roblox official endpoint failed, trying proxy:", officialError);
    return await getJson(proxyUrl);
  }
}

export async function discoverUniverseIds(): Promise<string[]> {
  const sessionId = crypto.randomUUID();
  const ids = new Set<string>();

  const sortsUrl =
    `${OFFICIAL_BASE}/explore-api/v1/get-sorts?sessionId=${sessionId}&device=computer&country=all`;
  const proxySortsUrl =
    `${PROXY_BASE}/explore-api/v1/get-sorts?sessionId=${sessionId}&device=computer&country=all`;

  const sorts = await fetchWithFallback(sortsUrl, proxySortsUrl);
  const sortList = Array.isArray(sorts.sorts) ? sorts.sorts : [];

  const preferred = new Set([
    "top-playing-now",
    "top-rated",
    "top-grossing",
    "up-and-coming"
  ]);

  for (const rawSort of sortList) {
    if (!rawSort || typeof rawSort !== "object") continue;
    const sort = rawSort as Record<string, unknown>;
    const sortId = String(sort.sortId ?? sort.id ?? "");
    if (!sortId) continue;
    const name = String(sort.name ?? sort.sortDisplayName ?? sortId).toLowerCase();

    if (preferred.size && !preferred.has(sortId) && !name.includes("playing") && !name.includes("popular")) {
      continue;
    }

    const official =
      `${OFFICIAL_BASE}/explore-api/v1/get-sort-content?sessionId=${sessionId}&sortId=${encodeURIComponent(sortId)}&device=computer&country=all&maxRows=100`;
    const proxy =
      `${PROXY_BASE}/explore-api/v1/get-sort-content?sessionId=${sessionId}&sortId=${encodeURIComponent(sortId)}&device=computer&country=all&maxRows=100`;

    try {
      const content = await fetchWithFallback(official, proxy);
      for (const id of extractUniverseIds(content)) ids.add(id);
    } catch (error) {
      console.warn(`Could not read Roblox sort ${sortId}:`, error);
    }
  }

  if (ids.size === 0) {
    throw new Error("Roblox discovery returned no universe IDs");
  }

  return [...ids].slice(0, 300);
}

export async function getUniverseThumbnails(universeIds: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();

  for (let i = 0; i < universeIds.length; i += 100) {
    const batch = universeIds.slice(i, i + 100);
    if (!batch.length) continue;

    const query = batch.join(",");
    const params = "?universeIds=" + encodeURIComponent(query) + "&returnPolicy=PlaceHolder&size=150x150&format=Png&isCircular=false";

    try {
      const response = await fetchWithFallback(
        OFFICIAL_GAME_ICONS + params,
        PROXY_GAME_ICONS + params
      );
      const data = Array.isArray(response.data) ? response.data : [];

      for (const item of data) {
        if (!item || typeof item !== "object") continue;
        const row = item as Record<string, unknown>;
        const targetId = String(row.targetId ?? "");
        const imageUrl = String(row.imageUrl ?? "").trim();
        if (/^\d+$/.test(targetId) && imageUrl) result.set(targetId, imageUrl);
      }
    } catch (error) {
      console.warn("Could not fetch Roblox game thumbnails:", error);
    }
  }

  return result;
}

export async function getUniverseInfo(universeIds: string[]) {
  const result: Array<Record<string, unknown>> = [];
  const seenUniverseIds = new Set<string>();

  for (let i = 0; i < universeIds.length; i += 10) {
    const batch = universeIds.slice(i, i + 10);
    const query = batch.join(",");
    const official = `${OFFICIAL_GAMES}?universeIds=${query}`;
    const proxy = `${PROXY_GAMES}?universeIds=${query}`;
    const response = await fetchWithFallback(official, proxy);
    const data = Array.isArray(response.data) ? response.data : [];

    if (!Array.isArray(response.data)) {
      throw new Error("Roblox universe info response had invalid data");
    }

    for (const item of data) {
      if (item && typeof item === "object") {
        const row = item as Record<string, unknown>;
        const id = row.id ?? row.universeId;
        if (id == null) continue;
        const textId = String(id);
        if (!/^\d+$/.test(textId) || textId === "0" || seenUniverseIds.has(textId)) continue;
        seenUniverseIds.add(textId);
        result.push(row);
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  return result;
}

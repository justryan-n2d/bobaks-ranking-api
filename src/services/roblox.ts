import crypto from "node:crypto";

const OFFICIAL_BASE = "https://apis.roblox.com";
const OFFICIAL_GAMES = "https://games.roblox.com/v1/games";
const PROXY_BASE = "https://apis.roproxy.com";
const PROXY_GAMES = "https://games.roproxy.com/v1/games";

type Json = Record<string, unknown>;

async function getJson(url: string): Promise<Json> {
  const response = await fetch(url, {
    headers: { "User-Agent": "BobaksRanking/1.0" }
  });

  if (!response.ok) {
    throw new Error(`Roblox HTTP ${response.status} for ${url}`);
  }

  return (await response.json()) as Json;
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

export async function getUniverseInfo(universeIds: string[]) {
  const result: Array<Record<string, unknown>> = [];

  for (let i = 0; i < universeIds.length; i += 10) {
    const batch = universeIds.slice(i, i + 10);
    const query = batch.join(",");
    const official = `${OFFICIAL_GAMES}?universeIds=${query}`;
    const proxy = `${PROXY_GAMES}?universeIds=${query}`;
    const response = await fetchWithFallback(official, proxy);
    const data = Array.isArray(response.data) ? response.data : [];

    for (const item of data) {
      if (item && typeof item === "object") result.push(item as Record<string, unknown>);
    }

    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  return result;
}

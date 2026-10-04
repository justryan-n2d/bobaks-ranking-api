export interface DemoJson {
  [key: string]: unknown;
}

const ICON = "/assets/bobaks-logo.png";
const UPDATED_AT = "2026-10-05T00:10:00.000Z";
const NEXT_COLLECTION_AT = "2026-10-05T00:20:00.000Z";

const GAMES = [
  ["1001","Skybound Islands","Cloud Nine Studio"],
  ["1002","Cafe After School","Study Break Games"],
  ["1003","Dungeon Clash","Nightforge"],
  ["1004","Pet Garden","Cozy Pixel"],
  ["1005","Blade Arena","Iron Lotus"],
  ["1006","Ocean Rescue","Blue Current"],
  ["1007","Tycoon Trails","Trailhead Games"],
  ["1008","Tower Sprint","Vertical Works"],
  ["1009","Anime Battleground","Nova Fighters"],
  ["1010","Cozy Town","Warm Lantern"],
  ["1011","Build It Together","Brick & Bloom"],
  ["1012","Treasure Hunt","Compass Crew"],
  ["1013","Race Legends","Nitro Road"],
  ["1014","Mystery Mansion","Velvet Key"],
  ["1015","Farm Bloom","Green Acre"],
  ["1016","Space Frontier","Orbit Forge"],
  ["1017","Obby Rush","Jump Lab"],
  ["1018","Dragon Valley","Ember Peak"],
  ["1019","School Hangout","After Class"],
  ["1020","City Life","Metro Pixel"],
  ["1021","Zombie Escape","Night Shift"],
  ["1022","Starship Command","Deep Orbit"],
  ["1023","Parkour Peak","Momentum Devs"],
  ["1024","Fashion Rush","Runway Club"],
  ["1025","Mini Kingdom","Tiny Crown"],
  ["1026","Fishing Haven","Harbor House"],
  ["1027","Heist Crew","Gold Street"],
  ["1028","Island Survival","Wild Tide"],
  ["1029","Magic Academy","Moonlit Labs"],
  ["1030","Pizza Place RP","Slice Studio"]
];

const LIVE_SCORES = [
  48210, 43900, 40120, 36980, 33150, 29800, 27640, 25120, 22950, 21100,
  19440, 18120, 16980, 15820, 14760, 13640, 12580, 11680, 10820, 10040,
  9320,  8620,  7980,  7340,  6710,  6090,  5480,  4870,  4260,  3650
];

const LIVE_CHANGES = [
   3,  -2,  8,  1, -4,  6, -1, 12, -3,  2,
   5,  -6,  4,  0,  9, -2,  7, -8,  1,  3,
  -5, 10, -1,  2, -3,  4, -7,  6, -2,  1
];

function gameRecord(index: number) {
  const [id, name, creator] = GAMES[index];
  return {
    id: Number(id),
    name,
    creatorName: creator,
    universeId: Number(id) * 10,
    placeId: Number(id) * 100,
    description: "Demo Roblox experience used only for isolated Cloudflare Preview UI testing.",
    iconUrl: ICON,
    currentPlayers: LIVE_SCORES[index],
    updatedAt: UPDATED_AT,
    createdAt: "2026-06-01T00:00:00.000Z"
  };
}

function periodScores(period: string): number[] {
  if (period === "week") {
    return LIVE_SCORES.map((value, i) => Math.max(100, value + (15 - i) * 110));
  }
  if (period === "month") {
    return LIVE_SCORES.map((value, i) => Math.max(100, value + (i % 6) * 170 - 400));
  }
  if (period === "year") {
    return LIVE_SCORES.map((value, i) => Math.max(100, value + ((29 - i) % 7) * 260 - 700));
  }
  return [...LIVE_SCORES];
}

function periodOrder(period: string): number[] {
  const base = GAMES.map((_, i) => i);
  if (period === "week") return [2,0,5,7,3,1,9,14,21,11,4,15,8,17,6,22,10,13,12,18,25,16,19,24,27,20,28,23,29,26];
  if (period === "month") return [7,3,0,12,5,2,9,14,17,1,21,10,4,18,6,24,15,11,8,13,19,22,25,27,16,20,26,28,29,23];
  if (period === "year") return [9,14,17,1,6,21,0,12,18,3,25,10,7,4,22,15,2,28,11,24,13,5,27,16,19,8,23,20,26,29];
  return base;
}

function rankRows(period: string): DemoJson[] {
  const scores = periodScores(period);
  const order = periodOrder(period);
  return order.map((gameIndex, rankIndex) => {
    const game = gameRecord(gameIndex);
    const previousRank = LIVE_CHANGES[gameIndex] === 0 ? rankIndex + 1 : Math.max(1, rankIndex + 1 - LIVE_CHANGES[gameIndex]);
    const score = scores[gameIndex];
    return {
      id: 9000 + rankIndex,
      gameId: String(game.id),
      period,
      rank: rankIndex + 1,
      score,
      previousRank,
      calculatedAt: UPDATED_AT,
      rankChange: previousRank - (rankIndex + 1),
      game
    };
  });
}

function historyFor(gameId: string, days: number): DemoJson[] {
  const seed = Number(gameId) - 1000;
  const length = Math.max(2, Math.min(365, days));
  const points: DemoJson[] = [];
  for (let i = length - 1; i >= 0; i--) {
    const date = new Date(Date.parse(UPDATED_AT) - i * 86400000).toISOString();
    const base = 1800 + seed * 90;
    const wave = Math.round(Math.sin((length - i + seed) / 2.2) * 420);
    const trend = (length - i) * 18;
    points.push({
      timestamp: date,
      playerCount: Math.max(250, base + wave + trend)
    });
  }
  return points;
}

function rankHistoryFor(gameId: string, days: number): DemoJson[] {
  const seed = Number(gameId) - 1000;
  const length = Math.max(2, Math.min(31, days));
  return Array.from({ length }, (_, i) => {
    const rank = 4 + ((seed + i * 3) % 40);
    const date = new Date(Date.parse(UPDATED_AT) - (length - 1 - i) * 86400000).toISOString();
    return {
      date: date.slice(0, 10),
      rank,
      averagePlayers: Math.max(250, 2400 + seed * 55 + Math.sin(i + seed) * 300),
      gamesRanked: 100
    };
  });
}

function gameDetail(gameId: string): DemoJson | null {
  const index = GAMES.findIndex(([id]) => id === gameId);
  if (index < 0) return null;
  const game = gameRecord(index);
  const live = rankRows("live").find(row => String(row.gameId) === gameId);
  return {
    ...game,
    gameId,
    rankings: { live: live ? { rank: live.rank, score: live.score, previousRank: live.previousRank, rankChange: live.rankChange } : null }
  };
}

function socialFeed(period: string, origin: string): DemoJson {
  const rankings = rankRows(period);
  const rankingItems = rankings.slice(0, 10).map(row => ({
    rank: Number(row.rank),
    gameId: String(row.gameId),
    name: String((row.game as DemoJson).name),
    creator: String((row.game as DemoJson).creatorName),
    score: Number(row.score),
    rankChange: Number(row.rankChange)
  }));
  const trendingItems = rankings
    .filter(row => Number(row.rankChange) > 0)
    .sort((a, b) => Number(b.rankChange) - Number(a.rankChange))
    .slice(0, 10)
    .map(row => ({
      rank: Number(row.rank),
      gameId: String(row.gameId),
      name: String((row.game as DemoJson).name),
      creator: String((row.game as DemoJson).creatorName),
      score: Number(row.score),
      rankChange: Number(row.rankChange)
    }));
  const peaks = GAMES.slice(0, 10).map(([id, name, creator], i) => ({
    gameId: id,
    name,
    creator,
    peakPlayers: LIVE_SCORES[i] + 5000 + i * 250,
    peakAt: new Date(Date.parse(UPDATED_AT) - i * 86400000).toISOString(),
    url: new URL("/game/" + id, origin).toString()
  }));
  const rankingUrl = new URL(period === "week" ? "/rankings/weekly" : period === "month" ? "/rankings/monthly" : period === "year" ? "/rankings/yearly" : "/", origin).toString();
  const unit = period === "live" ? "players" : "avg players";
  return {
    generatedAt: UPDATED_AT,
    source: "Bobaks demo dataset",
    period,
    ranking: { title: "🔥 Top 10 Roblox games", path: rankingUrl, items: rankingItems },
    trending: { title: "📈 Trending Roblox games", path: rankingUrl, items: trendingItems },
    peaks: { title: "Highest recorded Roblox peaks on Bobaks", items: peaks, recentItems: peaks },
    posts: {
      ranking: {
        title: "Top 10 Roblox games",
        url: rankingUrl,
        text: ["🔥 Top 10 Roblox games", "", ...rankingItems.map(item => item.rank + ". " + item.name + " · " + Math.round(item.score) + " " + unit), "", "Visit Bobaks Ranking:", rankingUrl].join("\n")
      },
      trending: {
        title: "Trending Roblox games",
        url: rankingUrl,
        text: ["📈 Trending Roblox games", "", ...trendingItems.map(item => "▲ " + item.name + " · +" + item.rankChange + " ranks · #" + item.rank), "", "Visit Bobaks Ranking:", rankingUrl].join("\n")
      },
      peaks: {
        title: "Highest recorded Roblox peaks on Bobaks",
        text: ["🏆 Highest recorded Roblox peaks on Bobaks", "", ...peaks.map(item => "🏆 " + item.name + " · " + item.peakPlayers + " peak players · " + String(item.peakAt).slice(0,10) + " · " + item.url)].join("\n")
      }
    }
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-bobaks-demo": "1"
    }
  });
}

export function handleDemoApiRequest(request: Request): Response {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/api/health") {
    return json({ ok: true, service: "bobaks-demo-preview", timestamp: UPDATED_AT });
  }

  if (path === "/api/games") {
    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") ?? 100)));
    const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0));
    return json({ data: GAMES.slice(offset, offset + limit).map((_, i) => gameRecord(offset + i)) });
  }

  const gameMatch = path.match(/^\/api\/games\/(\d+)(?:\/(history|peak|rank-history))?$/);
  if (gameMatch) {
    const gameId = gameMatch[1];
    const suffix = gameMatch[2];
    const game = gameDetail(gameId);
    if (!game) return json({ error: "Game not found" }, 404);
    if (!suffix) return json({ data: game });
    if (suffix === "peak") {
      const index = GAMES.findIndex(([id]) => id === gameId);
      return json({ data: { peakPlayers: LIVE_SCORES[index] + 5000 + index * 250, peakAt: UPDATED_AT } });
    }
    if (suffix === "history") {
      const days = Math.max(1, Math.min(365, Number(url.searchParams.get("days") ?? 365)));
      return json({ gameId, days, resolution: days > 31 ? "daily" : "snapshot", data: historyFor(gameId, days) });
    }
    const days = Math.max(1, Math.min(31, Number(url.searchParams.get("days") ?? 31)));
    return json({ gameId, days, data: rankHistoryFor(gameId, days) });
  }

  if (path === "/api/rankings") {
    const period = url.searchParams.get("period") || "live";
    if (!["live", "week", "month", "year"].includes(period)) return json({ error: "Invalid period" }, 400);
    return json({
      period,
      updatedAt: UPDATED_AT,
      refreshIntervalSeconds: 600,
      nextCollectionAt: NEXT_COLLECTION_AT,
      nextRefreshAt: NEXT_COLLECTION_AT,
      data: rankRows(period)
    });
  }

  if (path === "/api/search") {
    const q = (url.searchParams.get("q") || "").trim().toLowerCase();
    const data = GAMES
      .filter(([, name, creator]) => name.toLowerCase().includes(q) || creator.toLowerCase().includes(q))
      .slice(0, 50)
      .map(([id, name, creator]) => ({ id: Number(id), name, creatorName: creator }));
    return json({ data });
  }

  if (path === "/api/social/feed") {
    const period = url.searchParams.get("period") || "live";
    if (!["live","week","month","year"].includes(period)) return json({ error: "Invalid period" }, 400);
    return json(socialFeed(period, url.origin));
  }

  return json({ error: "Demo endpoint not found" }, 404);
}

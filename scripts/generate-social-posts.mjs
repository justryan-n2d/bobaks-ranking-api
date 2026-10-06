const DEFAULT_API_ORIGIN = "https://bobaks-ranking-api-service.bobaksranking.workers.dev";
const PERIODS = ["live", "week", "month", "year"];

function assertPost(text, label) {
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("Missing social post: " + label);
  }
  return text.trimEnd() + "\n";
}

export function buildSocialFiles(feeds, generatedAt) {
  const byPeriod = new Map((feeds || []).map(feed => [String(feed.period), feed]));
  const files = {};

  for (const period of PERIODS) {
    const feed = byPeriod.get(period);
    if (!feed?.posts) throw new Error("Missing social feed: " + period);

    files["top10-" + period + ".txt"] = assertPost(
      feed.posts.ranking?.text,
      "ranking " + period
    );
    files["trending-" + period + ".txt"] = assertPost(
      feed.posts.trending?.text,
      "trending " + period
    );
  }

  const peakFeed = byPeriod.get("live");
  if (!peakFeed?.posts) throw new Error("Missing social feed: live");

  files["peak-records.txt"] = assertPost(
    peakFeed.posts.peaks?.text,
    "peak records"
  );

  files["manifest.json"] = JSON.stringify({
    generatedAt,
    periods: PERIODS,
    files: Object.keys(files).filter(name => name !== "manifest.json")
  }, null, 2) + "\n";

  return files;
}

async function fetchFeed(apiOrigin, period) {
  const url = apiOrigin.replace(/\/$/, "") + "/api/social/feed?period=" + encodeURIComponent(period);
  const response = await fetch(url, {
    headers: { accept: "application/json" }
  });

  if (!response.ok) {
    throw new Error("Social feed failed for " + period + ": HTTP " + response.status);
  }

  return response.json();
}

async function main() {
  const apiOrigin = process.env.BOBAKS_API_ORIGIN || DEFAULT_API_ORIGIN;
  const outputDir = process.env.SOCIAL_OUTPUT_DIR || "social-output";
  const generatedAt = new Date().toISOString();

  const feeds = await Promise.all(PERIODS.map(period => fetchFeed(apiOrigin, period)));
  const files = buildSocialFiles(feeds, generatedAt);

  const fs = await import("node:fs/promises");
  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(outputDir, { recursive: true });

  for (const [name, content] of Object.entries(files)) {
    await fs.writeFile(outputDir + "/" + name, content, "utf8");
  }

  console.log("Generated " + Object.keys(files).length + " social content files in " + outputDir);
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

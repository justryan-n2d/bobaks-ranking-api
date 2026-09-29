import test from "node:test";
import assert from "node:assert/strict";
import { buildSocialFiles } from "../scripts/generate-social-posts.mjs";

test("social generator creates top-10 and trending files for each period plus one peak file", () => {
  const feeds = [
    { period: "live", posts: { ranking: { text: "LIVE TOP" }, trending: { text: "LIVE TREND" }, peaks: { text: "PEAKS" } } },
    { period: "week", posts: { ranking: { text: "WEEK TOP" }, trending: { text: "WEEK TREND" }, peaks: { text: "PEAKS" } } },
    { period: "month", posts: { ranking: { text: "MONTH TOP" }, trending: { text: "MONTH TREND" }, peaks: { text: "PEAKS" } } },
    { period: "year", posts: { ranking: { text: "YEAR TOP" }, trending: { text: "YEAR TREND" }, peaks: { text: "PEAKS" } } }
  ];

  const files = buildSocialFiles(feeds, "2026-09-30T00:30:00.000Z");

  assert.equal(files["top10-live.txt"], "LIVE TOP\n");
  assert.equal(files["top10-week.txt"], "WEEK TOP\n");
  assert.equal(files["top10-month.txt"], "MONTH TOP\n");
  assert.equal(files["top10-year.txt"], "YEAR TOP\n");
  assert.equal(files["trending-live.txt"], "LIVE TREND\n");
  assert.equal(files["trending-week.txt"], "WEEK TREND\n");
  assert.equal(files["trending-month.txt"], "MONTH TREND\n");
  assert.equal(files["trending-year.txt"], "YEAR TREND\n");
  assert.equal(files["peak-records.txt"], "PEAKS\n");
  assert.match(files["manifest.json"], /2026-09-30T00:30:00.000Z/);
  assert.match(files["manifest.json"], /top10-week\.txt/);
});

test("social generator rejects missing required feed sections", () => {
  assert.throws(
    () => buildSocialFiles([{ period: "week", posts: { ranking: { text: "TOP" } } }], "2026-09-30T00:30:00.000Z"),
    /missing social post/i
  );
});

test("scheduled workflow runs daily, supports manual dispatch, and retains artifacts briefly", async () => {
  const fs = await import("node:fs/promises");
  const workflow = await fs.readFile(".github/workflows/social-content-generation.yml", "utf8");
  assert.match(workflow, /schedule:/);
  assert.match(workflow, /cron: "30 0 \* \* \*"/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /node scripts\/generate-social-posts\.mjs/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.match(workflow, /retention-days: 14/);
  assert.match(workflow, /permissions:\n\s+contents: read/);
});


test("Discord publisher builds a plain webhook payload and accepts 204", async () => {
  assert.deepEqual(
    buildDiscordPayload("🔥 Top 10 Roblox games this week"),
    { content: "🔥 Top 10 Roblox games this week" }
  );

  let requested = null;
  const fakeFetch = async (url, init) => {
    requested = { url, init };
    return new Response(null, { status: 204 });
  };

  const result = await publishDiscordPost(
    "https://discord.com/api/webhooks/123/token",
    "🔥 Top 10 Roblox games this week",
    fakeFetch
  );

  assert.equal(result, true);
  assert.equal(requested.init.method, "POST");
  assert.equal(requested.init.headers["content-type"], "application/json");
  assert.equal(requested.init.headers["user-agent"], "Bobaks-Ranking-Social/1.0");
  assert.match(requested.url, /wait=true$/);
  assert.deepEqual(
    JSON.parse(requested.init.body),
    { content: "🔥 Top 10 Roblox games this week" }
  );
});

test("Discord publisher rejects non-success responses", async () => {
  const fakeFetch = async () => new Response("rate limited", { status: 429 });
  await assert.rejects(
    () => publishDiscordPost(
      "https://discord.com/api/webhooks/123/token",
      "hello",
      fakeFetch
    ),
    /Discord webhook failed: HTTP 429/
  );
});

test("Discord publisher rejects empty content", async () => {
  await assert.rejects(
    () => publishDiscordPost("https://discord.com/api/webhooks/123/token", "   ", async () => new Response(null, {status:204})),
    /content is empty/i
  );
});

test("Discord publisher splits oversized posts without exceeding Discord's message limit", () => {
  const chunks = splitDiscordContent("line\n" + "x".repeat(4500));
  assert.ok(chunks.length >= 3);
  assert.ok(chunks.every(chunk => chunk.length <= 2000));
  assert.equal(chunks.join("").length, 4504);
});

test("Discord schedule publishes live content daily and weekly content on Monday", () => {
  assert.deepEqual(
    selectDiscordFiles([], 2),
    ["top10-live.txt", "trending-live.txt"]
  );
  assert.deepEqual(
    selectDiscordFiles([], 1),
    ["top10-live.txt", "trending-live.txt", "top10-week.txt"]
  );
});


test("scheduled workflow wires Discord publishing through a repository secret", async () => {
  const fs = await import("node:fs/promises");
  const workflow = await fs.readFile(".github/workflows/social-content-generation.yml", "utf8");
  assert.ok(workflow.includes("DISCORD_SOCIAL_WEBHOOK_URL: ${{ secrets.DISCORD_SOCIAL_WEBHOOK_URL }}"));
  assert.ok(workflow.includes("node scripts/publish-social-discord.mjs"));
  assert.match(workflow, /Publish selected social content to Discord/);
});

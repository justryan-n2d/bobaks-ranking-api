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

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const frontendPath = path.resolve("frontend/index.html");

test("frontend entrypoint exists and exposes Phase 5 gamer surfaces", () => {
  assert.ok(fs.existsSync(frontendPath));
  const html = fs.readFileSync(frontendPath, "utf8");

  assert.match(html, /<title>Bobaks Ranking \| Live Rankings & Historical Trends<\/title>/);
  assert.match(html, /const API='https:\/\/bobaks-ranking-api-service\.ryan-oledan0\.workers\.dev';/);

  for (const period of ["live", "week", "month", "year"]) {
    assert.match(html, new RegExp("['\\"]" + period + "['\\"]"));
  }

  assert.match(html, /Rankings/);
  assert.match(html, /Saved/);
  assert.match(html, /Compare/);
  assert.match(html, /Share rank card/);
  assert.match(html, /Recorded Peak/);
  assert.match(html, /Rank History/);
  assert.match(html, /What is happening\?/);
  assert.match(html, /How Bobaks Rankings Work/);
  assert.match(html, /\/api\/search\?q=/);
  assert.match(html, /\/api\/games\//);
  assert.match(html, /\/history\?days=365/);
  assert.match(html, /\/rank-history\?days=31/);
  assert.match(html, /\/peak/);
  assert.match(html, /previousRank/);
  assert.match(html, /rankChange/);

  assert.doesNotMatch(html, /bobaks-api-production\.up\.railway\.app/);
});

test("frontend uses a device-local watchlist and bounded comparison", () => {
  const html = fs.readFileSync(frontendPath, "utf8");

  assert.match(html, /bobaks\.watchlist/);
  assert.match(html, /state\.watchlist\.length<25/);
  assert.match(html, /state\.compare\.length<2/);
  assert.match(html, /navigator\.share/);
  assert.match(html, /canvas\.toBlob/);
});

test("frontend refreshes from the server-supplied next collection time", () => {
  const html = fs.readFileSync(frontendPath, "utf8");

  assert.match(html, /function scheduleRefresh\(\)/);
  assert.match(html, /state\.nextRefreshAt=p\.nextCollectionAt\|\|fallbackNext\(\)/);
  assert.match(html, /setTimeout\(\(\)=>loadRankings\(\),delay\)/);
  assert.match(html, /countdown\(state\.nextRefreshAt\)/);
});

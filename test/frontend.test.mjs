import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const frontendPath = path.resolve("frontend/index.html");

function readHtml() {
  assert.ok(fs.existsSync(frontendPath));
  return fs.readFileSync(frontendPath, "utf8");
}

test("frontend entrypoint exists and exposes Phase 5 gamer surfaces", () => {
  const html = readHtml();
  assert.match(html, /<title>Bobaks Ranking \| Live Rankings & Historical Trends<\/title>/);
  assert.match(html, /const API='https:\/\/bobaks-ranking-api-service\.ryan-oledan0\.workers\.dev';/);
  for (const period of ["live", "week", "month", "year"]) {
    assert.ok(html.includes("'" + period + "'") || html.includes('"' + period + '"'));
  }
  for (const feature of ["Rankings", "Saved", "Compare", "Share rank card", "Recorded Peak", "Rank History", "How Bobaks Rankings Work"]) {
    assert.match(html, new RegExp(feature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(html, /\/api\/search\?q=/);
  assert.match(html, /\/api\/games\//);
  assert.match(html, /\/history\?days=365/);
  assert.match(html, /\/rank-history\?days=31/);
  assert.match(html, /\/peak/);
  assert.match(html, /previousRank/);
  assert.match(html, /rankChange/);
  assert.doesNotMatch(html, /bobaks-api-production\.up\.railway\.app/);
});

test("frontend script parses as valid JavaScript", () => {
  const html = readHtml();
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match, "frontend must contain an inline script");
  assert.doesNotThrow(() => new Function(match[1]));
});

test("frontend uses a device-local watchlist and bounded comparison", () => {
  const html = readHtml();
  assert.match(html, /bobaks\.watchlist/);
  assert.match(html, /state\.saved\.length<25/);
  assert.match(html, /state\.compare\.length<2/);
  assert.match(html, /navigator\.share/);
});

test("frontend refreshes from the server-supplied next collection time", () => {
  const html = readHtml();
  assert.match(html, /function schedule\(\)/);
  assert.match(html, /state\.next=p\.nextCollectionAt\|\|fallbackNext\(\)/);
  assert.match(html, /state\.timer=setTimeout\(loadRankings,/);
});

test("search does not replace the input element while typing", () => {
  const html = fs.readFileSync(frontendPath, "utf8");

  assert.match(html, /function renderSearchResults\(\)/);
  assert.match(html, /query!==state\.query\.trim\(\)/);
  assert.match(html, /state\.results=\[\];renderSearchResults\(\)/);
  assert.match(html, /state\.results=\(p\.data\|\|\[\]\)\.map/);
  assert.doesNotMatch(
    html,
    /async function search\(q\)\{[^}]*render\(\);[^}]*state\.results=/
  );
  assert.doesNotMatch(
    html,
    /setInterval\(\(\)=>\{if\(state\.view==='home'\|\|state\.view==='detail'\)render\(\)\},1000\)/
  );
});

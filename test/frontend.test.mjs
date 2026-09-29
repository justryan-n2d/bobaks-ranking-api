import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const frontendPath = path.resolve("frontend/index.html");

test("frontend entrypoint exists and contains the Bobaks app", () => {
  assert.ok(fs.existsSync(frontendPath), "frontend/index.html must exist");

  const html = fs.readFileSync(frontendPath, "utf8");

  assert.match(html, /<!doctype html>/i);
  assert.match(html, /<title>Bobaks Ranking \| Live Rankings & Historical Trends<\/title>/);
  assert.match(html, /const API='https:\/\/bobaks-ranking-api-service\.ryan-oledan0\.workers\.dev';/);
});

test("frontend uses the current rankings API contract", () => {
  const html = fs.readFileSync(frontendPath, "utf8");

  assert.match(
    html,
    /\/api\/rankings\?period='\+period/,
    "frontend must build ranking requests with the current period query parameter"
  );

  for (const period of ["live", "week", "month", "year"]) {
    assert.match(
      html,
      new RegExp(`["']${period}["']`),
      `frontend must support the ${period} ranking period`
    );
  }

  assert.match(html, /\/api\/search\?q=/);
  assert.match(html, /\/api\/games\//);
  assert.match(html, /\/history\?days=365/);
  assert.match(html, /historyResolution:h\.resolution\|\|'snapshot'/);
  assert.match(html, /historyResolutionText\(resolution\)/);
  assert.match(html, /\/api\/games\/.*\/peak/);
  assert.match(html, /peakPlayers/);

  assert.doesNotMatch(html, /\/api\/rankings\/(live|weekly|monthly|yearly)/);
  assert.doesNotMatch(html, /bobaks-api-production\.up\.railway\.app/);
});
test("frontend exposes and uses the client refresh scheduler", () => {
  const html = fs.readFileSync(frontendPath, "utf8");

  assert.match(html, /function scheduleRefresh\(seconds\)/);
  assert.match(html, /refreshTimer=setTimeout\(\(\)=>load\(\),delay\)/);
  assert.match(html, /state\.refreshIntervalSeconds=Number\(p\.refreshIntervalSeconds\)\|\|600/);
  assert.match(html, /state\.nextRefreshAt=p\.nextCollectionAt\|\|p\.nextRefreshAt\|\|fallbackNextCollectionAt\(\)/);
  assert.match(html, /scheduleRefresh\(Math\.max\(1,\(new Date\(state\.nextRefreshAt\)\.getTime\(\)-Date\.now\(\)\)\/1000\)\)/);
  assert.doesNotMatch(html, /state\.nextRefreshAt=new Date\(Date\.now\(\)\+state\.refreshIntervalSeconds\*1000\)\.toISOString\(\)/);
  assert.doesNotMatch(html, /function refreshDue\(\)/);
  assert.doesNotMatch(html, /setInterval\(\(\)=>\{if\(!state\.selected&&!state\.loading&&refreshDue\(\)\)load\(\)\},1000\)/);
  assert.match(html, /\.game\{width:100%;min-width:0/);
  assert.match(html, /grid-template-columns:30px 48px minmax\(0,1fr\) max-content 22px/);
  assert.match(html, /\.icon-wrap\{width:48px;height:48px\}/);
  assert.match(html, /\.players\{grid-column:4;grid-row:1\/span 2/);
});


test("frontend exposes the ranking transparency page", () => {
  const html = fs.readFileSync(frontendPath, "utf8");

  assert.match(html, /How Bobaks Rankings Work/);
  assert.match(html, /\/api\/rankings\/methodology/);
  assert.match(html, /\/api\/rankings\/audit/);
  assert.match(html, /Methodology version:/);
  assert.match(html, /Minimum samples/);
  assert.match(html, /Minimum coverage/);
  assert.match(html, /Tie-break/);
  assert.match(html, /Audit status:/);
  assert.match(html, /Limitations/);
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const frontendPath = path.resolve("frontend/index.html");

test("frontend entrypoint exists and contains the Bobaks app", () => {
  assert.ok(fs.existsSync(frontendPath), "frontend/index.html must exist");

  const html = fs.readFileSync(frontendPath, "utf8");

  assert.match(html, /<!doctype html>/i);
  assert.match(html, /<title>Bobaks Ranking \| Roblox Game Rankings<\/title>/);
  assert.match(html, /const API='https:\/\/bobaks-api-production\.up\.railway\.app';/);
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
  assert.match(html, /\/api\/games\/.*\/peak/);
  assert.match(html, /peakPlayers/);

  assert.doesNotMatch(html, /\/api\/rankings\/(live|weekly|monthly|yearly)/);
});
test("frontend exposes and uses the server refresh schedule", () => {
  const html = fs.readFileSync(frontendPath, "utf8");

  assert.match(html, /nextRefreshAt=p\.nextRefreshAt/);
  assert.match(html, /refreshIntervalSeconds=Number\(p\.refreshIntervalSeconds\)/);
  assert.match(html, /new Date\(s\)\.getTime\(\)-Date\.now\(\)/);
  assert.match(html, /countdown\(state\.nextRefreshAt\)/);
  assert.doesNotMatch(html, /countdown\(state\.updatedAt\)/);
  assert.doesNotMatch(html, /getTime\(\)\+300000/);
  assert.match(html, /new Date\(state\.nextRefreshAt\)\.getTime\(\)/);
  assert.match(html, /!state\.loading&&state\.nextRefreshAt/);
});

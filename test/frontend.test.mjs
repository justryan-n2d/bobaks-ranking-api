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

  for (const period of ["live", "week", "month", "year"]) {
    assert.match(
      html,
      new RegExp(`/api/rankings\\?period=${period}`),
      `frontend must request the ${period} ranking period`
    );
  }

  assert.match(html, /\/api\/search\?q=/);
  assert.match(html, /\/api\/games\//);
  assert.match(html, /\/history\?days=365/);

  assert.doesNotMatch(html, /\/api\/rankings\/(live|weekly|monthly|yearly)/);
});

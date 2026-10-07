import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflowPath = new URL("../.github/workflows/cloudflare-frontend.yml", import.meta.url);
const workflow = fs.readFileSync(workflowPath, "utf8");

test("frontend deployment uses the authoritative web repository and stable production hostname", () => {
  assert.match(
    workflow,
    /repository:\s*justryan-n2d\/bobaks-ranking-web/,
    "Cloudflare frontend deployment must checkout bobaks-ranking-web",
  );
  assert.match(
    workflow,
    /path:\s*bobaks-ranking-web/,
    "frontend checkout must have a stable working path",
  );
  assert.match(
    workflow,
    /working-directory:\s*bobaks-ranking-web/,
    "frontend build must run from bobaks-ranking-web",
  );
  assert.match(
    workflow,
    /npm run build:vinext/,
    "frontend deployment must build the Cloudflare/Vinext output",
  );
  assert.match(
    workflow,
    /- name: Deploy authoritative web Worker[\s\S]*?working-directory:\s*bobaks-ranking-web[\s\S]*?run: npx @vinext\/cloudflare deploy --skip-build/,
    "authoritative frontend must use the Vinext Cloudflare deploy command for the generated build",
  );
  assert.match(
    workflow,
    /FRONTEND="https:\/\/web\.bobaksranking\.workers\.dev"/,
    "production smoke test must target the stable web Worker hostname",
  );
});

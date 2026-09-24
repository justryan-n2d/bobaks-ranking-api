import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync('src/worker.ts', 'utf8');
const api = fs.readFileSync('src/worker-api.ts', 'utf8');
const wrangler = fs.readFileSync('wrangler.jsonc', 'utf8');

test('Cloudflare worker is configured with Hyperdrive and static assets', () => {
  assert.match(wrangler, /"main":\s*"src\/worker\.ts"/);
  assert.match(wrangler, /"binding":\s*"HYPERDRIVE"/);
  assert.match(wrangler, /"id":\s*"a4e7160cac2648ebb6b35937f45d9457"/);
  assert.match(wrangler, /"directory":\s*"\.\/frontend"/);
  assert.match(wrangler, /"run_worker_first":\s*\["\/api\/\*"\]/);
});

test('Cloudflare worker exposes the existing read-only API contract', () => {
  for (const route of ['/api/health', '/api/rankings', '/api/games', '/api/search']) {
    assert.match(api, new RegExp(route.replaceAll('/', '\\/')));
  }
  assert.match(api, /GET/);
  assert.match(api, /Method not allowed/);
  assert.match(api, /Database unavailable/);
  assert.match(worker, /url\.pathname\.startsWith\('\/api\/'\)/);
});

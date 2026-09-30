import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root=process.cwd();
const bytes=file=>fs.statSync(path.join(root,file)).size;

test("frontend static budget stays within the performance envelope",()=>{
  assert.ok(bytes("frontend/index.html")<=70000,"index.html exceeds 70 KB");
  assert.ok(bytes("frontend/app.js")<=80000,"app.js exceeds 80 KB");
  assert.ok(bytes("frontend/qrcode-generator.js")<=60000,"qrcode-generator.js exceeds 60 KB");
});

test("optional JavaScript is not shipped on the critical HTML path",()=>{
  const html=fs.readFileSync(path.join(root,"frontend/index.html"),"utf8");
  assert.match(html,/app\.js/);
  assert.doesNotMatch(html,/qrcode-generator\.js/);
  assert.doesNotMatch(html,/return-loops\.js/);
});

test("same-origin API proxy and response caching are implemented",()=>{
  const app=fs.readFileSync(path.join(root,"frontend/app.js"),"utf8");
  const worker=fs.readFileSync(path.join(root,"src/frontend-worker.ts"),"utf8");
  assert.match(app,/const API='\/api';window\.__BOBAKS_API__=API;/);
  assert.match(app,/API_CACHE=new Map\(\)/);
  assert.match(app,/cache:cache\?'default':'no-store'/);
  assert.match(worker,/url\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(worker,/max-age=300, s-maxage=86400/);
});

test("games endpoint remains bounded and paginated",()=>{
  const api=fs.readFileSync(path.join(root,"src/api-worker.ts"),"utf8");
  assert.match(api,/limit<1 \|\| limit>100/);
  assert.match(api,/offset<0/);
  assert.match(api,/limit: String\(pagination\.limit\)/);
  assert.match(api,/offset: String\(pagination\.offset\)/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { getUniverseThumbnails } from "../src/services/roblox";

test("falls back to proxy when official thumbnail endpoint returns HTTP error", async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    requestedUrls.push(url);

    if (url.includes("thumbnails.roblox.com")) {
      return new Response(JSON.stringify({ errors: [{ message: "temporary failure" }] }), {
        status: 503,
        headers: { "content-type": "application/json" }
      });
    }

    return new Response(
      JSON.stringify({
        data: [{ targetId: 123, imageUrl: "https://tr.rbxcdn.com/proxy.png" }]
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    const icons = await getUniverseThumbnails(["123"]);

    assert.equal(icons.get("123"), "https://tr.rbxcdn.com/proxy.png");
    assert.equal(requestedUrls.length, 2);
    assert.match(requestedUrls[0], /thumbnails\.roblox\.com/);
    assert.match(requestedUrls[1], /thumbnails\.roproxy\.com/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("uses Roblox game icons endpoint for universe icon URLs", async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];

  globalThis.fetch = (async (input: string | URL | Request) => {
    requestedUrls.push(String(input));
    return new Response(
      JSON.stringify({
        data: [{ targetId: 123, imageUrl: "https://tr.rbxcdn.com/example.png" }]
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    const icons = await getUniverseThumbnails(["123"]);

    assert.equal(icons.get("123"), "https://tr.rbxcdn.com/example.png");
    assert.match(requestedUrls[0], /\/v1\/games\/icons\?/);
    assert.match(requestedUrls[0], /returnPolicy=PlaceHolder/);
    assert.match(requestedUrls[0], /size=150x150/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

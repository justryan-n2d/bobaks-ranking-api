import test from "node:test";
import assert from "node:assert/strict";
import { getUniverseThumbnails } from "../src/services/roblox";

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
    assert.match(requestedUrls[0], /\/v1\/games\/icons\?/);\n    assert.match(requestedUrls[0], /returnPolicy=PlaceHolder/);\n    assert.match(requestedUrls[0], /size=150x150/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { collectOnce } from "../src/worker";

function response(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init
  });
}

test("scheduled collector performs the complete collection cycle", async () => {
  const calls: { url: string; method: string; body?: string; headers: Headers }[] = [];

  const fakeFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : undefined,
      headers: new Headers(init?.headers)
    });

    if (url.includes("/get-sorts?")) {
      return response({ sorts: [{ sortId: "top-playing-now" }] });
    }

    if (url.includes("/get-sort-content?")) {
      return response({
        data: [{ universeId: "1001" }, { universeId: "1002" }]
      });
    }

    if (url.includes("thumbnails.roblox.com")) {
      return response({
        data: [
          { targetId: 1001, imageUrl: "https://cdn.example/1.png" },
          { targetId: 1002, imageUrl: "https://cdn.example/2.png" }
        ]
      });
    }

    if (url.includes("games.roblox.com/v1/games")) {
      return response({
        data: [
          {
            id: 1001,
            rootPlaceId: 2001,
            name: "One",
            creator: { id: 3001, name: "A" },
            playing: 12
          },
          {
            id: 1002,
            rootPlaceId: 2002,
            name: "Two",
            creator: { id: 3002, name: "B" },
            playing: 34
          }
        ]
      });
    }

    if (url.includes("/rest/v1/Game?")) {
      return response([
        { id: "11", universeId: "1001" },
        { id: "12", universeId: "1002" }
      ]);
    }

    if (url.includes("/rest/v1/GameSnapshot")) {
      return new Response("", { status: 201 });
    }

    if (url.includes("/rest/v1/rpc/record_game_peaks")) {
      assert.equal(init?.headers instanceof Headers ? init.headers.get("Authorization") : new Headers(init?.headers).get("Authorization"), null);
      assert.equal(new Headers(init?.headers).get("apikey"), "test");
      const body = JSON.parse(String(init?.body));
      assert.ok(Array.isArray(body.p_rows));
      assert.equal(body.rows, undefined);
      return response(2);
    }

    if (url.includes("/rest/v1/rpc/refresh_rankings")) {
      assert.equal(new Headers(init?.headers).get("Authorization"), null);
      assert.equal(new Headers(init?.headers).get("apikey"), "test");
      return response(null);
    }

    if (url.includes("/rest/v1/DataCollectionLog")) {
      return new Response("", { status: 201 });
    }

    throw new Error(`Unhandled URL: ${url}`);
  };

  const result = await collectOnce(
    {
      SUPABASE_URL: "https://zhrfozouzvxhpkylmpwh.supabase.co",
      SUPABASE_SECRET_KEY: "test",
      ROBLOX_THROTTLE_MS: "0"
    },
    fakeFetch
  );

  assert.deepEqual(result, {
    gamesChecked: 2,
    gamesUpdated: 2,
    errors: 0
  });
  assert.equal(calls.filter(c => c.url.includes("/rest/v1/Game?")).length, 1);
  assert.equal(calls.filter(c => c.url.includes("/rest/v1/GameSnapshot")).length, 1);
  assert.equal(calls.filter(c => c.url.includes("/rest/v1/rpc/record_game_peaks")).length, 1);
  assert.equal(calls.filter(c => c.url.includes("/rest/v1/rpc/refresh_rankings")).length, 1);
  assert.equal(calls.filter(c => c.url.includes("/rest/v1/DataCollectionLog")).length, 1);
});

test("collector records failure when Roblox is unavailable", async () => {
  let loggedBody = "";

  const fakeFetch: typeof fetch = async (input, init) => {
    const url = String(input);

    if (url.includes("/get-sorts?")) {
      throw new Error("network down");
    }

    if (url.includes("/rest/v1/DataCollectionLog")) {
      loggedBody = String(init?.body);
      return new Response("", { status: 201 });
    }

    throw new Error(`Unhandled URL: ${url}`);
  };

  await assert.rejects(
    () =>
      collectOnce(
        {
          SUPABASE_URL: "https://zhrfozouzvxhpkylmpwh.supabase.co",
          SUPABASE_SECRET_KEY: "test",
          ROBLOX_THROTTLE_MS: "0"
        },
        fakeFetch
      ),
    /network down/
  );

  assert.match(loggedBody, /"status":"failed"/);
  assert.match(loggedBody, /"errors":1/);
});

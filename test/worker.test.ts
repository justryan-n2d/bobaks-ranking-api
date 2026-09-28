import test from "node:test";
import assert from "node:assert/strict";
import { collectOnce, scheduledForTest, summarizeYesterday } from "../src/worker";

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

    if (url.includes("/get-sorts?")) return response({ sorts: [{ sortId: "top-playing-now" }] });
    if (url.includes("/get-sort-content?")) return response({ data: [{ universeId: "1001" }, { universeId: "1002" }] });
    if (url.includes("thumbnails.roblox.com")) return response({ data: [
      { targetId: 1001, imageUrl: "https://cdn.example/1.png" },
      { targetId: 1002, imageUrl: "https://cdn.example/2.png" }
    ] });
    if (url.includes("games.roblox.com/v1/games")) return response({ data: [
      { id: 1001, rootPlaceId: 2001, name: "One", creator: { id: 3001, name: "A" }, playing: 12 },
      { id: 1002, rootPlaceId: 2002, name: "Two", creator: { id: 3002, name: "B" }, playing: 34 }
    ] });
    if (url.includes("/rest/v1/rpc/list_stale_active_games")) return response([]);
    if (url.includes("/rest/v1/Game?")) return response([
      { id: "11", universeId: "1001" },
      { id: "12", universeId: "1002" }
    ]);
    if (url.includes("/rest/v1/GameSnapshot")) return new Response("", { status: 201 });

    if (url.includes("/rest/v1/rpc/record_game_peaks")) {
      assert.equal(new Headers(init?.headers).get("Authorization"), null);
      assert.equal(new Headers(init?.headers).get("apikey"), "sb_secret_test");
      const body = JSON.parse(String(init?.body));
      assert.ok(Array.isArray(body.p_rows));
      assert.equal(body.rows, undefined);
      return response(2);
    }

    if (url.includes("/rest/v1/rpc/refresh_rankings")) {
      assert.equal(new Headers(init?.headers).get("Authorization"), null);
      assert.equal(new Headers(init?.headers).get("apikey"), "sb_secret_test");
      return response(null);
    }

    if (url.includes("/rest/v1/DataCollectionLog")) return new Response("", { status: 201 });
    throw new Error(`Unhandled URL: ${url}`);
  };

  const result = await collectOnce({
    SUPABASE_URL: "https://zhrfozouzvxhpkylmpwh.supabase.co",
    SUPABASE_SECRET_KEY: "sb_secret_test",
    ROBLOX_THROTTLE_MS: "0"
  }, fakeFetch);

  assert.deepEqual(result, { gamesChecked: 2, gamesUpdated: 2, errors: 0 });

  const snapshotCall = calls.find(c => c.url.includes("/rest/v1/GameSnapshot"));
  const logCall = calls.find(c => c.url.includes("/rest/v1/DataCollectionLog"));
  assert.ok(snapshotCall);
  assert.ok(logCall);
  const snapshotPayload = JSON.parse(String(snapshotCall.body)) as Array<Record<string, unknown>>;
  const logPayload = JSON.parse(String(logCall.body)) as Record<string, unknown>;
  assert.equal(typeof snapshotPayload[0].collectionRunId, "string");
  assert.equal(snapshotPayload[0].collectionRunId, snapshotPayload[1].collectionRunId);
  assert.equal(snapshotPayload[0].collectionRunId, logPayload.collectionRunId);
  assert.equal(calls.filter(c => c.url.includes("/rest/v1/Game?on_conflict=universeId")).length, 1);
  assert.equal(calls.filter(c => c.url.includes("/rest/v1/GameSnapshot")).length, 1);
  assert.equal(calls.filter(c => c.url.includes("/rest/v1/rpc/record_game_peaks")).length, 1);
  assert.equal(calls.filter(c => c.url.includes("/rest/v1/rpc/refresh_rankings")).length, 1);
  assert.equal(calls.filter(c => c.url.includes("/rest/v1/DataCollectionLog")).length, 1);
});

test("thumbnail collection falls back from empty official data and preserves missing icons", async () => {
  let gameBody = "";
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = String(input);

    if (url.includes("/get-sorts?")) return response({ sorts: [{ sortId: "top-playing-now" }] });
    if (url.includes("/get-sort-content?")) {
      return response({ data: [{ universeId: "1001" }, { universeId: "1002" }] });
    }
    if (url.startsWith("https://thumbnails.roblox.com/v1/games/icons")) {
      return response({ data: [] });
    }
    if (url.startsWith("https://thumbnails.roproxy.com/v1/games/icons")) {
      return response({ data: [{ targetId: 1001, imageUrl: "https://cdn.example/proxy.png" }] });
    }
    if (url.startsWith("https://thumbnails.roblox.com/v1/places/gameicons")) {
      return response({ data: [{ targetId: 2002, imageUrl: "https://cdn.example/place.png" }] });
    }
    if (url.startsWith("https://thumbnails.roproxy.com/v1/places/gameicons")) {
      return response({ data: [] });
    }
    if (url.includes("games.roblox.com/v1/games")) return response({ data: [
      { id: 1001, rootPlaceId: 2001, name: "One", creator: { id: 3001, name: "A" }, playing: 12 },
      { id: 1002, rootPlaceId: 2002, name: "Two", creator: { id: 3002, name: "B" }, playing: 34 }
    ] });
    if (url.includes("/rest/v1/rpc/list_stale_active_games")) return response([]);
    if (url.includes("/rest/v1/Game?")) {
      gameBody = String(init?.body);
      return response([{ id: "11", universeId: "1001" }, { id: "12", universeId: "1002" }]);
    }
    if (url.includes("/rest/v1/GameSnapshot")) return new Response("", { status: 201 });
    if (url.includes("/rest/v1/rpc/record_game_peaks")) return response(2);
    if (url.includes("/rest/v1/rpc/refresh_rankings")) return response(null);
    if (url.includes("/rest/v1/DataCollectionLog")) return new Response("", { status: 201 });
    throw new Error(`Unhandled URL: ${url}`);
  };

  await collectOnce({
    SUPABASE_URL: "https://zhrfozouzvxhpkylmpwh.supabase.co",
    SUPABASE_SECRET_KEY: "sb_secret_test",
    ROBLOX_THROTTLE_MS: "0"
  }, fakeFetch);

  const payload = JSON.parse(gameBody) as Array<Record<string, unknown>>;
  assert.equal(payload.length, 2);
  assert.equal(payload[0].iconUrl, "https://cdn.example/proxy.png");
  assert.equal(payload[1].iconUrl, "https://cdn.example/place.png");
});

test("collector verifies stale active games without changing coverage rules", async () => {
  const calls: { url: string; method: string; body?: string }[] = [];
  let verificationMode = false;
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : undefined
    });

    if (url.includes("/get-sorts?")) {
      return response({ sorts: [{ sortId: "top-playing-now" }] });
    }
    if (url.includes("/get-sort-content?")) {
      return response({ data: [{ universeId: "1001" }] });
    }
    if (url.includes("thumbnails.roblox.com")) return response({ data: [] });

    if (url.includes("games.roblox.com/v1/games")) {
      if (verificationMode) {
        return response({
          data: [
            { id: 2002, rootPlaceId: 3002, name: "Stale", creator: { id: 3002, name: "B" }, playing: 34 }
          ]
        });
      }
      return response({
        data: [
          { id: 1001, rootPlaceId: 2001, name: "One", creator: { id: 3001, name: "A" }, playing: 12 }
        ]
      });
    }

    if (url.includes("/rest/v1/rpc/list_stale_active_games")) {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.equal(body.p_limit, 100);
      assert.equal(typeof body.p_cutoff, "string");
      verificationMode = true;
      return response([{
        id: "22",
        universeId: "2002",
        lastVerificationAttemptAt: null,
        verificationMisses: 0
      }]);
    }

    if (url.includes("/rest/v1/Game?on_conflict=universeId")) {
      return response([{ id: "11", universeId: "1001" }]);
    }

    if (url.includes("/rest/v1/GameSnapshot")) return new Response("", { status: 201 });
    if (url.includes("/rest/v1/rpc/record_game_peaks")) return response(1);

    if (url.includes("/rest/v1/rpc/verify_game_activity")) {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.deepEqual(body.p_attempted_universe_ids, ["2002"]);
      assert.deepEqual(body.p_found_universe_ids, ["2002"]);
      assert.deepEqual(body.p_uncertain_universe_ids, []);
      return response(0);
    }

    if (url.includes("/rest/v1/DataCollectionLog")) return new Response("", { status: 201 });
    if (url.includes("/rest/v1/rpc/refresh_rankings")) return response(null);

    throw new Error(`Unhandled URL: ${url}`);
  };

  const result = await collectOnce({
    SUPABASE_URL: "https://zhrfozouzvxhpkylmpwh.supabase.co",
    SUPABASE_SECRET_KEY: "sb_secret_test",
    ROBLOX_THROTTLE_MS: "0"
  }, fakeFetch);

  assert.deepEqual(result, { gamesChecked: 1, gamesUpdated: 1, errors: 0 });
  const verification = calls.find(call => call.url.includes("/rest/v1/rpc/verify_game_activity"));
  assert.ok(verification);
});

test("collector does not count a Roblox source gap as a miss", async () => {
  const calls: { url: string; method: string; body?: string }[] = [];
  let verificationMode = false;

  const fakeFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : undefined
    });

    if (url.includes("/get-sorts?")) {
      return response({ sorts: [{ sortId: "top-playing-now" }] });
    }
    if (url.includes("/get-sort-content?")) {
      return response({ data: [{ universeId: "1001" }] });
    }
    if (url.startsWith("https://thumbnails.roblox.com/v1/games/icons")) {
      return verificationMode
        ? response({ data: [{ targetId: 2003, imageUrl: "https://cdn.example/2003.png" }] })
        : response({ data: [] });
    }
    if (url.startsWith("https://thumbnails.roproxy.com/v1/games/icons")) {
      return response({ data: [] });
    }

    if (url.startsWith("https://games.roblox.com/v1/games")) {
      if (verificationMode) {
        return response({
          data: [
            { id: 2002, rootPlaceId: 3002, name: "Found", creator: { id: 3002, name: "B" }, playing: 34 }
          ]
        });
      }
      return response({
        data: [
          { id: 1001, rootPlaceId: 2001, name: "One", creator: { id: 3001, name: "A" }, playing: 12 }
        ]
      });
    }

    if (url.startsWith("https://games.roproxy.com/v1/games")) {
      return response({ data: [] });
    }

    if (url.startsWith("https://develop.roblox.com/v1/universes/2004")) {
      return new Response(JSON.stringify("not-an-object"), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }

    if (url.includes("/rest/v1/rpc/list_stale_active_games")) {
      verificationMode = true;
      return response([
        { id: "22", universeId: "2002", lastVerificationAttemptAt: null, verificationMisses: 0 },
        { id: "23", universeId: "2003", lastVerificationAttemptAt: null, verificationMisses: 1 },
        { id: "24", universeId: "2004", lastVerificationAttemptAt: null, verificationMisses: 2 }
      ]);
    }

    if (url.includes("/rest/v1/Game?on_conflict=universeId")) {
      return response([{ id: "11", universeId: "1001" }]);
    }
    if (url.includes("/rest/v1/GameSnapshot")) return new Response("", { status: 201 });
    if (url.includes("/rest/v1/rpc/record_game_peaks")) return response(1);

    if (url.includes("/rest/v1/rpc/verify_game_activity")) {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.deepEqual(body.p_attempted_universe_ids, ["2002", "2003", "2004"]);
      assert.deepEqual(new Set(body.p_found_universe_ids as string[]), new Set(["2002", "2003"]));
      assert.deepEqual(body.p_uncertain_universe_ids, ["2004"]);
      return response(1);
    }

    if (url.includes("/rest/v1/DataCollectionLog")) return new Response("", { status: 201 });
    if (url.includes("/rest/v1/rpc/refresh_rankings")) return response(null);

    throw new Error(`Unhandled URL: ${url}`);
  };

  const result = await collectOnce({
    SUPABASE_URL: "https://zhrfozouzvxhpkylmpwh.supabase.co",
    SUPABASE_SECRET_KEY: "sb_secret_test",
    ROBLOX_THROTTLE_MS: "0"
  }, fakeFetch);

  assert.deepEqual(result, { gamesChecked: 1, gamesUpdated: 1, errors: 0 });
  const verification = calls.find(call => call.url.includes("/rest/v1/rpc/verify_game_activity"));
  assert.ok(verification);
});

test("collector retries transient Roblox discovery failures", async () => {
  let attempts = 0;
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/get-sorts?")) {
      attempts++;
      if (attempts === 1) throw new Error("network down");
      return response({ sorts: [{ sortId: "top-playing-now" }] });
    }
    if (url.includes("/get-sort-content?")) return response({ data: [{ universeId: "1001" }] });
    if (url.includes("thumbnails.roblox.com")) return response({ data: [] });
    if (url.includes("games.roblox.com/v1/games")) return response({
      data: [{ id: 1001, rootPlaceId: 2001, name: "One", creator: { id: 3001, name: "A" }, playing: 12 }]
    });
    if (url.includes("/rest/v1/rpc/list_stale_active_games")) return response([]);
    if (url.includes("/rest/v1/Game?")) return response([{ id: "11", universeId: "1001" }]);
    if (url.includes("/rest/v1/GameSnapshot")) return new Response("", { status: 201 });
    if (url.includes("/rest/v1/rpc/record_game_peaks")) return response(1);
    if (url.includes("/rest/v1/rpc/refresh_rankings")) return response(null);
    if (url.includes("/rest/v1/DataCollectionLog")) return new Response("", { status: 201 });
    throw new Error(`Unhandled URL: ${url}`);
  };

  const result = await collectOnce({
    SUPABASE_URL: "https://zhrfozouzvxhpkylmpwh.supabase.co",
    SUPABASE_SECRET_KEY: "sb_secret_test",
    ROBLOX_THROTTLE_MS: "0"
  }, fakeFetch);

  assert.deepEqual(result, { gamesChecked: 1, gamesUpdated: 1, errors: 0 });
  assert.equal(attempts, 2);
});

test("collector finalizes the run before refreshing rankings", async () => {
  const order: string[] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/get-sorts?")) return response({ sorts: [{ sortId: "top-playing-now" }] });
    if (url.includes("/get-sort-content?")) return response({ data: [{ universeId: "1001" }] });
    if (url.includes("thumbnails.roblox.com")) return response({ data: [] });
    if (url.includes("games.roblox.com/v1/games")) return response({
      data: [{ id: 1001, rootPlaceId: 2001, name: "One", creator: { id: 3001, name: "A" }, playing: 12 }]
    });
    if (url.includes("/rest/v1/rpc/list_stale_active_games")) return response([]);
    if (url.includes("/rest/v1/Game?")) return response([{ id: "11", universeId: "1001" }]);
    if (url.includes("/rest/v1/GameSnapshot")) {
      order.push("snapshot");
      return new Response("", { status: 201 });
    }
    if (url.includes("/rest/v1/rpc/record_game_peaks")) {
      order.push("peaks");
      return response(1);
    }
    if (url.includes("/rest/v1/DataCollectionLog")) {
      order.push("log");
      const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.equal(payload.status, "success");
      return new Response("", { status: 201 });
    }
    if (url.includes("/rest/v1/rpc/refresh_rankings")) {
      order.push("refresh");
      return response(null);
    }
    throw new Error(`Unhandled URL: ${url}`);
  };

  await collectOnce({
    SUPABASE_URL: "https://zhrfozouzvxhpkylmpwh.supabase.co",
    SUPABASE_SECRET_KEY: "sb_secret_test",
    ROBLOX_THROTTLE_MS: "0"
  }, fakeFetch);

  assert.deepEqual(order, ["snapshot", "peaks", "log", "refresh"]);
});

test("collector keeps a collected run valid when ranking refresh fails", async () => {
  let logCount = 0;
  let logStatus = "";
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/get-sorts?")) return response({ sorts: [{ sortId: "top-playing-now" }] });
    if (url.includes("/get-sort-content?")) return response({ data: [{ universeId: "1001" }] });
    if (url.includes("thumbnails.roblox.com")) return response({ data: [] });
    if (url.includes("games.roblox.com/v1/games")) return response({
      data: [{ id: 1001, rootPlaceId: 2001, name: "One", creator: { id: 3001, name: "A" }, playing: 12 }]
    });
    if (url.includes("/rest/v1/rpc/list_stale_active_games")) return response([]);
    if (url.includes("/rest/v1/Game?")) return response([{ id: "11", universeId: "1001" }]);
    if (url.includes("/rest/v1/GameSnapshot")) return new Response("", { status: 201 });
    if (url.includes("/rest/v1/rpc/record_game_peaks")) return response(1);
    if (url.includes("/rest/v1/DataCollectionLog")) {
      logCount++;
      logStatus = String((JSON.parse(String(init?.body)) as Record<string, unknown>).status);
      return new Response("", { status: 201 });
    }
    if (url.includes("/rest/v1/rpc/refresh_rankings")) return new Response("refresh failed", { status: 500 });
    throw new Error(`Unhandled URL: ${url}`);
  };

  await assert.rejects(() => collectOnce({
    SUPABASE_URL: "https://zhrfozouzvxhpkylmpwh.supabase.co",
    SUPABASE_SECRET_KEY: "sb_secret_test",
    ROBLOX_THROTTLE_MS: "0"
  }, fakeFetch), /refresh_rankings HTTP 500/);

  assert.equal(logCount, 1);
  assert.equal(logStatus, "success");
});

test("collector records failure when Roblox is unavailable", async () => {
  let loggedBody = "";
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/get-sorts?")) throw new Error("network down");
    if (url.includes("/rest/v1/DataCollectionLog")) {
      loggedBody = String(init?.body);
      return new Response("", { status: 201 });
    }
    throw new Error(`Unhandled URL: ${url}`);
  };

  await assert.rejects(() => collectOnce({
    SUPABASE_URL: "https://zhrfozouzvxhpkylmpwh.supabase.co",
    SUPABASE_SECRET_KEY: "sb_secret_test",
    ROBLOX_THROTTLE_MS: "0"
  }, fakeFetch), /network down/);

  assert.match(loggedBody, /"status":"failed"/);
  assert.match(loggedBody, /"errors":1/);
  assert.match(loggedBody, /"errorMessage":"network down"/);
  const failedLog = JSON.parse(loggedBody) as Record<string, unknown>;
  assert.equal(typeof failedLog.collectionRunId, "string");
});

test("daily summarization calls the protected Supabase RPC", async () => {
  let called = false;
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    if (!url.includes("/rest/v1/rpc/summarize_yesterday_daily_game_stats")) throw new Error(`Unhandled URL: ${url}`);
    called = true;
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("Authorization"), null);
    assert.equal(headers.get("apikey"), "sb_secret_test");
    assert.deepEqual(JSON.parse(String(init?.body)), {});
    return response(2);
  };

  const result = await summarizeYesterday({
    SUPABASE_URL: "https://zhrfozouzvxhpkylmpwh.supabase.co",
    SUPABASE_SECRET_KEY: "sb_secret_test"
  }, fakeFetch);

  assert.equal(result, 2);
  assert.equal(called, true);
});

test("daily cron writes a success report", async () => {
  const calls: string[] = [];
  let logBody = "";
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/rest/v1/rpc/summarize_yesterday_daily_game_stats")) return response(138);
    if (url.includes("/rest/v1/DataCollectionLog")) {
      logBody = String(init?.body);
      return new Response("", { status: 201 });
    }
    throw new Error(`Unexpected call from daily cron: ${url}`);
  };

  await scheduledForTest({ cron: "5 0 * * *", scheduledTime: Date.now() }, {
    SUPABASE_URL: "https://zhrfozouzvxhpkylmpwh.supabase.co",
    SUPABASE_SECRET_KEY: "sb_secret_test"
  }, fakeFetch);

  assert.equal(calls.length, 2);
  assert.equal(calls[0].includes("summarize_yesterday_daily_game_stats"), true);
  assert.equal(calls[1].includes("/rest/v1/DataCollectionLog"), true);
  assert.match(logBody, /"status":"daily_summary_success"/);
  assert.match(logBody, /"gamesUpdated":138/);
  assert.match(logBody, /"errors":0/);
});

test("daily cron writes a failure report and rethrows", async () => {
  let logBody = "";
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/rest/v1/rpc/summarize_yesterday_daily_game_stats")) return new Response("summary failed", { status: 500 });
    if (url.includes("/rest/v1/DataCollectionLog")) {
      logBody = String(init?.body);
      return new Response("", { status: 201 });
    }
    throw new Error(`Unexpected call from daily cron: ${url}`);
  };

  await assert.rejects(() => scheduledForTest({ cron: "5 0 * * *", scheduledTime: Date.now() }, {
    SUPABASE_URL: "https://zhrfozouzvxhpkylmpwh.supabase.co",
    SUPABASE_SECRET_KEY: "sb_secret_test"
  }, fakeFetch), /summarize_yesterday_daily_game_stats HTTP 500/);

  assert.match(logBody, /"status":"daily_summary_failed"/);
  assert.match(logBody, /"gamesUpdated":0/);
  assert.match(logBody, /"errors":1/);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { createAuthClient } from "../frontend/account-core.mjs";

function createMemoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function baseSession(overrides = {}) {
  return {
    access_token: "access-token",
    refresh_token: "refresh-token",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: "bearer",
    user: { id: "user-1", email: "player@example.com" },
    ...overrides
  };
}

test("signIn uses the password grant and persists the returned session", async () => {
  const calls = [];
  const storage = createMemoryStorage();
  const client = createAuthClient({
    supabaseUrl: "https://example.supabase.co",
    publishableKey: "sb_publishable_test",
    storage,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse(baseSession());
    }
  });

  const session = await client.signIn({
    email: "player@example.com",
    password: "correct-password"
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://example.supabase.co/auth/v1/token?grant_type=password");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.get('apikey'), "sb_publishable_test");
  assert.equal(JSON.parse(calls[0].init.body).email, "player@example.com");
  assert.equal(session.user.id, "user-1");
  assert.equal(JSON.parse(storage.getItem("bobaks.auth.session.v1")).access_token, "access-token");
});

test("signUp accepts the raw session response shape and uses the redirect_to field", async () => {
  const calls = [];
  const storage = createMemoryStorage();
  const client = createAuthClient({
    supabaseUrl: "https://example.supabase.co",
    publishableKey: "sb_publishable_test",
    storage,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({
        ...baseSession(),
        user: { id: "user-2", email: "new@example.com" }
      });
    }
  });

  const result = await client.signUp({
    email: "new@example.com",
    password: "correct-password",
    displayName: "New Player",
    emailRedirectTo: "https://bobaks.example/confirm"
  });

  const payload = JSON.parse(calls[0].init.body);
  assert.equal(calls[0].url, "https://example.supabase.co/auth/v1/signup");
  assert.equal(payload.data.display_name, "New Player");
  assert.equal(payload.redirect_to, "https://bobaks.example/confirm");
  assert.equal(result.user.id, "user-2");
  assert.equal(result.session.user.id, "user-2");
});

test("getSession refreshes an expiring session and stores the rotated session", async () => {
  const storage = createMemoryStorage({
    "bobaks.auth.session.v1": JSON.stringify(baseSession({
      access_token: "old-access",
      refresh_token: "old-refresh",
      expires_at: Math.floor(Date.now() / 1000) + 10
    }))
  });
  const calls = [];

  const client = createAuthClient({
    supabaseUrl: "https://example.supabase.co",
    publishableKey: "sb_publishable_test",
    storage,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse(baseSession({
        access_token: "new-access",
        refresh_token: "new-refresh"
      }));
    }
  });

  const session = await client.getSession();

  assert.equal(session.access_token, "new-access");
  assert.equal(calls[0].url, "https://example.supabase.co/auth/v1/token?grant_type=refresh_token");
  assert.equal(JSON.parse(calls[0].init.body).refresh_token, "old-refresh");
  assert.equal(JSON.parse(storage.getItem("bobaks.auth.session.v1")).refresh_token, "new-refresh");
});

test("getUser retries once with a refreshed token after a 401", async () => {
  const storage = createMemoryStorage({
    "bobaks.auth.session.v1": JSON.stringify(baseSession())
  });
  const calls = [];

  const client = createAuthClient({
    supabaseUrl: "https://example.supabase.co",
    publishableKey: "sb_publishable_test",
    storage,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });

      if (url.endsWith("/auth/v1/user")) {
        if (calls.filter(call => call.url.endsWith("/auth/v1/user")).length === 1) {
          return jsonResponse({ message: "expired" }, 401);
        }
        return jsonResponse({ id: "user-1", email: "player@example.com" });
      }

      return jsonResponse(baseSession({ access_token: "refreshed-access" }));
    }
  });

  const user = await client.getUser();

  assert.equal(user.id, "user-1");
  const userCalls = calls.filter(call => call.url.endsWith("/auth/v1/user"));
  assert.equal(userCalls.length, 2);
  assert.equal(userCalls[1].init.headers.get('authorization'), "Bearer refreshed-access");
});

test("signOut always clears the local session even when remote logout fails", async () => {
  const storage = createMemoryStorage({
    "bobaks.auth.session.v1": JSON.stringify(baseSession())
  });

  const client = createAuthClient({
    supabaseUrl: "https://example.supabase.co",
    publishableKey: "sb_publishable_test",
    storage,
    fetchImpl: async () => jsonResponse({ message: "logout unavailable" }, 503)
  });

  await assert.rejects(client.signOut(), /logout unavailable/);
  assert.equal(storage.getItem("bobaks.auth.session.v1"), null);
});

test("addWatchlistGame sends a composite-key upsert and returns the saved row", async () => {
  const calls = [];
  const storage = createMemoryStorage({
    "bobaks.auth.session.v1": JSON.stringify(baseSession())
  });
  const client = createAuthClient({
    supabaseUrl: "https://example.supabase.co",
    publishableKey: "sb_publishable_test",
    storage,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith("/auth/v1/user")) return jsonResponse(baseSession().user);
      return jsonResponse([{ user_id: "user-1", game_id: 42, created_at: "2026-10-01T00:00:00Z" }]);
    }
  });

  const saved = await client.addWatchlistGame("42");

  assert.deepEqual(saved, {
    user_id: "user-1",
    game_id: 42,
    created_at: "2026-10-01T00:00:00Z"
  });
  const request = calls.find(call => call.url.includes("/rest/v1/user_watchlist"));
  assert.ok(request);
  assert.equal(
    request.url,
    "https://example.supabase.co/rest/v1/user_watchlist?on_conflict=user_id%2Cgame_id"
  );
  assert.equal(request.init.method, "POST");
  assert.equal(
    request.init.headers.get("prefer"),
    "resolution=merge-duplicates,return=representation"
  );
  assert.deepEqual(JSON.parse(request.init.body), {
    user_id: "user-1",
    game_id: "42"
  });
});

test("removeWatchlistGame targets the signed-in user's game and returns removed rows", async () => {
  const calls = [];
  const storage = createMemoryStorage({
    "bobaks.auth.session.v1": JSON.stringify(baseSession())
  });
  const client = createAuthClient({
    supabaseUrl: "https://example.supabase.co",
    publishableKey: "sb_publishable_test",
    storage,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith("/auth/v1/user")) return jsonResponse(baseSession().user);
      return jsonResponse([{ user_id: "user-1", game_id: 42 }]);
    }
  });

  const removed = await client.removeWatchlistGame("42");

  assert.deepEqual(removed, [{ user_id: "user-1", game_id: 42 }]);
  const request = calls.find(call => call.url.includes("/rest/v1/user_watchlist"));
  assert.ok(request);
  assert.equal(
    request.url,
    "https://example.supabase.co/rest/v1/user_watchlist?user_id=eq.user-1&game_id=eq.42"
  );
  assert.equal(request.init.method, "DELETE");
  assert.equal(request.init.headers.get("prefer"), "return=representation");
});

test("authenticatedFetch includes the session bearer token and Supabase publishable key", async () => {
  const storage = createMemoryStorage({
    "bobaks.auth.session.v1": JSON.stringify(baseSession())
  });
  const calls = [];

  const client = createAuthClient({
    supabaseUrl: "https://example.supabase.co",
    publishableKey: "sb_publishable_test",
    storage,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse([]);
    }
  });

  const result = await client.authenticatedFetch(
    "/user_watchlist?select=game_id,created_at"
  );

  assert.deepEqual(result.data, []);
  assert.equal(
    calls[0].url,
    "https://example.supabase.co/rest/v1/user_watchlist?select=game_id,created_at"
  );
  assert.equal(calls[0].init.headers.get('apikey'), "sb_publishable_test");
  assert.equal(calls[0].init.headers.get('authorization'), "Bearer access-token");
});

test("saveComparison canonicalizes the game pair and targets its unique conflict columns", async () => {
  const storage = createMemoryStorage({
    "bobaks.auth.session.v1": JSON.stringify(baseSession())
  });
  const calls = [];

  const client = createAuthClient({
    supabaseUrl: "https://example.supabase.co",
    publishableKey: "sb_publishable_test",
    storage,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });

      if (url.endsWith("/auth/v1/user")) {
        return jsonResponse({ id: "user-1", email: "player@example.com" });
      }

      return jsonResponse([{
        id: "11111111-1111-1111-1111-111111111111",
        user_id: "user-1",
        game_id_a: 12,
        game_id_b: 42
      }]);
    }
  });

  const saved = await client.saveComparison("42", "12");
  const request = calls.find(call => call.url.includes("/rest/v1/saved_comparisons"));

  assert.equal(saved.game_id_a, 12);
  assert.equal(saved.game_id_b, 42);
  assert.equal(
    request.url,
    "https://example.supabase.co/rest/v1/saved_comparisons?on_conflict=user_id%2Cgame_id_a%2Cgame_id_b"
  );

  const payload = JSON.parse(request.init.body);
  assert.equal(payload.game_id_a, "12");
  assert.equal(payload.game_id_b, "42");
});


test("recoverSessionFromUrl consumes implicit-flow tokens, loads the user, and clears the fragment", async () => {
  const storage = createMemoryStorage();
  const calls = [];
  let replaced = false;

  const client = createAuthClient({
    supabaseUrl: "https://example.supabase.co",
    publishableKey: "sb_publishable_test",
    storage,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({ id: "user-3", email: "confirmed@example.com" });
    }
  });

  const session = await client.recoverSessionFromUrl({
    hash: "#access_token=fragment-access&refresh_token=fragment-refresh&expires_in=3600&token_type=bearer&type=signup",
    replaceUrl: () => { replaced = true; }
  });

  assert.equal(session.access_token, "fragment-access");
  assert.equal(session.refresh_token, "fragment-refresh");
  assert.equal(session.user.id, "user-3");
  assert.equal(calls[0].init.headers.get("authorization"), "Bearer fragment-access");
  assert.equal(replaced, true);
  assert.equal(JSON.parse(storage.getItem("bobaks.auth.session.v1")).user.id, "user-3");
});

test("resendSignupConfirmation calls the Supabase signup resend endpoint", async () => {
  const calls = [];
  const client = createAuthClient({
    supabaseUrl: "https://example.supabase.co",
    publishableKey: "sb_publishable_test",
    storage: createMemoryStorage(),
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({});
    }
  });

  await client.resendSignupConfirmation(
    "player@example.com",
    "https://bobaks.example/account"
  );

  assert.equal(calls[0].url, "https://example.supabase.co/auth/v1/resend");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    type: "signup",
    email: "player@example.com",
    redirect_to: "https://bobaks.example/account"
  });
});

test("getRobloxIdentity reads only the authenticated user's identity row", async () => {
  const calls = [];
  const client = createAuthClient({
    supabaseUrl: "https://example.supabase.co",
    publishableKey: "sb_publishable_test",
    storage: createMemoryStorage({
      "bobaks.auth.session.v1": JSON.stringify(baseSession())
    }),
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith("/auth/v1/user")) return jsonResponse(baseSession().user);
      return jsonResponse([{
        roblox_user_id: 12345,
        provider_subject: "12345",
        username: "Builder",
        display_name: "Builder",
        status: "connected"
      }]);
    }
  });

  const identity = await client.getRobloxIdentity();

  assert.equal(identity.roblox_user_id, 12345);
  const identityCall = calls.find(call => call.url.includes("/rest/v1/roblox_identities"));
  assert.ok(identityCall);
  assert.match(identityCall.url, /select=roblox_user_id/);
  assert.equal(identityCall.init.headers.get("authorization"), "Bearer access-token");
});


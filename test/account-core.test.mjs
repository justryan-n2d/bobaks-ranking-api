import assert from "node:assert/strict";
import { test } from "node:test";
import { createAuthClient } from "../frontend/account-core.mjs";

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); }
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
      return new Response(JSON.stringify({
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        token_type: "bearer",
        user: { id: "user-1", email: "player@example.com" }
      }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  const session = await client.signIn({
    email: "player@example.com",
    password: "correct-password"
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://example.supabase.co/auth/v1/token?grant_type=password");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.apikey, "sb_publishable_test");
  assert.equal(JSON.parse(calls[0].init.body).email, "player@example.com");
  assert.equal(session.user.id, "user-1");
  assert.equal(JSON.parse(storage.getItem("bobaks.auth.session.v1")).access_token, "access-token");
});

test("authenticated requests include the current access token", async () => {
  const storage = createMemoryStorage();
  storage.setItem("bobaks.auth.session.v1", JSON.stringify({
    access_token: "saved-access",
    refresh_token: "saved-refresh",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: "user-2", email: "second@example.com" }
  }));

  const calls = [];
  const client = createAuthClient({
    supabaseUrl: "https://example.supabase.co",
    publishableKey: "sb_publishable_test",
    storage,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: "user-2", email: "second@example.com" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  const user = await client.getUser();

  assert.equal(user.id, "user-2");
  assert.equal(calls[0].url, "https://example.supabase.co/auth/v1/user");
  assert.equal(calls[0].init.headers.authorization, "Bearer saved-access");
});

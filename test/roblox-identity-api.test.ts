import assert from "node:assert/strict";
import test from "node:test";
import { handleRobloxIdentityRequest } from "../src/roblox-identity";

const ENV = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SECRET_KEY: "sb_secret_test",
  ROBLOX_CLIENT_ID: "client-123",
  ROBLOX_CLIENT_SECRET: "secret-456",
  ROBLOX_REDIRECT_URI: "https://bobaks.example/account/roblox-callback",
  ROBLOX_OAUTH_COOKIE_SECRET: "test-cookie-secret-that-is-long-enough"
};

function response(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers }
  });
}

function authUser() {
  return { id: "user-1", email: "player@example.com" };
}

function makeFetch(overrides: Partial<Record<string, (url: URL, init: RequestInit) => Response | Promise<Response>>> = {}) {
  return async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const custom = overrides[url.pathname];
    if (custom) return custom(url, init);
    if (url.pathname === "/auth/v1/user") return response(authUser());
    if (url.pathname === "/oauth/v1/token") return response({
      access_token: "access-token-secret",
      refresh_token: "refresh-token-secret",
      expires_in: 899,
      token_type: "Bearer",
      scope: "openid profile"
    });
    if (url.pathname === "/oauth/v1/userinfo") return response({
      sub: "1516563360",
      name: "Example Display",
      nickname: "Example Display",
      preferred_username: "ExampleUser",
      profile: "https://www.roblox.com/users/1516563360/profile",
      picture: "https://tr.rbxcdn.com/avatar.png"
    });
    if (url.pathname === "/rest/v1/roblox_identities") {
      return response([{
        user_id: "user-1",
        roblox_user_id: 1516563360,
        provider_subject: "1516563360",
        username: "ExampleUser",
        display_name: "Example Display",
        profile_url: "https://www.roblox.com/users/1516563360/profile",
        avatar_url: "https://tr.rbxcdn.com/avatar.png",
        status: "connected",
        connected_at: "2026-10-05T00:00:00.000Z",
        last_verified_at: "2026-10-05T00:00:00.000Z",
        updated_at: "2026-10-05T00:00:00.000Z"
      }]);
    }
    throw new Error("Unhandled URL: " + url);
  };
}

test("start returns a PKCE Roblox authorization URL and a short-lived HttpOnly transaction cookie", async () => {
  const result = await handleRobloxIdentityRequest(
    new Request("https://api.example/api/identity/roblox/start", {
      method: "POST",
      headers: { authorization: "Bearer bobaks-access-token" }
    }),
    ENV,
    makeFetch()
  );

  assert.ok(result);
  assert.equal(result.status, 200);
  const body = await result.json() as { authorizeUrl: string };
  const url = new URL(body.authorizeUrl);

  assert.equal(url.origin, "https://apis.roblox.com");
  assert.equal(url.pathname, "/oauth/v1/authorize");
  assert.equal(url.searchParams.get("client_id"), "client-123");
  assert.equal(url.searchParams.get("redirect_uri"), ENV.ROBLOX_REDIRECT_URI);
  assert.equal(url.searchParams.get("scope"), "openid profile");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.ok(url.searchParams.get("state"));
  assert.ok(url.searchParams.get("code_challenge"));

  const cookie = result.headers.get("set-cookie") ?? "";
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /Secure/i);
  assert.match(cookie, /SameSite=Lax/i);
  assert.match(cookie, /Max-Age=300/i);
});

test("exchange validates state, completes PKCE, stores only sanitized Roblox identity fields, and never returns tokens", async () => {
  let tokenRequest: { headers: Headers; body: URLSearchParams } | null = null;
  let identityRequest: { headers: Headers; body: Record<string, unknown> } | null = null;

  const fetchImpl = makeFetch({
    "/oauth/v1/token": async (_url, init) => {
      tokenRequest = {
        headers: new Headers(init.headers),
        body: new URLSearchParams(String(init.body ?? ""))
      };
      return response({
        access_token: "access-token-secret",
        refresh_token: "refresh-token-secret",
        expires_in: 899,
        token_type: "Bearer",
        scope: "openid profile"
      });
    },
    "/rest/v1/roblox_identities": async (_url, init) => {
      identityRequest = {
        headers: new Headers(init.headers),
        body: JSON.parse(String(init.body ?? "{}"))
      };
      return response([{
        user_id: "user-1",
        roblox_user_id: 1516563360,
        provider_subject: "1516563360",
        username: "ExampleUser",
        display_name: "Example Display",
        profile_url: "https://www.roblox.com/users/1516563360/profile",
        avatar_url: "https://tr.rbxcdn.com/avatar.png",
        status: "connected"
      }]);
    }
  });

  const start = await handleRobloxIdentityRequest(
    new Request("https://api.example/api/identity/roblox/start", {
      method: "POST",
      headers: { authorization: "Bearer bobaks-access-token" }
    }),
    ENV,
    fetchImpl
  );
  assert.ok(start);

  const authorizeUrl = new URL((await start.json() as { authorizeUrl: string }).authorizeUrl);
  const cookie = start.headers.get("set-cookie")!.split(";")[0];

  const exchange = await handleRobloxIdentityRequest(
    new Request("https://api.example/api/identity/roblox/exchange", {
      method: "POST",
      headers: {
        authorization: "Bearer bobaks-access-token",
        cookie,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        code: "roblox-code-1",
        state: authorizeUrl.searchParams.get("state")
      })
    }),
    ENV,
    fetchImpl
  );

  assert.ok(exchange);
  assert.equal(exchange.status, 200);
  const body = await exchange.json() as Record<string, unknown>;
  assert.equal(body.roblox_user_id, 1516563360);
  assert.equal(body.username, "ExampleUser");
  assert.equal("access_token" in body, false);
  assert.equal("refresh_token" in body, false);

  assert.ok(tokenRequest);
  assert.equal(tokenRequest.body.get("code"), "roblox-code-1");
  assert.equal(tokenRequest.body.get("grant_type"), "authorization_code");
  assert.equal(tokenRequest.body.get("client_id"), ENV.ROBLOX_CLIENT_ID);
  assert.equal(tokenRequest.body.get("client_secret"), ENV.ROBLOX_CLIENT_SECRET);
  assert.ok(tokenRequest.body.get("code_verifier"));
  assert.ok(identityRequest);
  assert.equal(identityRequest.body.user_id, "user-1");
  assert.equal(identityRequest.body.roblox_user_id, "1516563360");
  assert.equal(identityRequest.body.provider_subject, "1516563360");
  assert.equal("access_token" in identityRequest.body, false);
  assert.equal("refresh_token" in identityRequest.body, false);
  assert.match(exchange.headers.get("set-cookie") ?? "", /Max-Age=0/);
});

test("exchange rejects a mismatched state before contacting Roblox token exchange", async () => {
  const calls: string[] = [];
  const fetchImpl = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push(new URL(String(input)).pathname);
    if (new URL(String(input)).pathname === "/auth/v1/user") return response(authUser());
    throw new Error("unexpected external call");
  };

  const start = await handleRobloxIdentityRequest(
    new Request("https://api.example/api/identity/roblox/start", {
      method: "POST",
      headers: { authorization: "Bearer bobaks-access-token" }
    }),
    ENV,
    fetchImpl
  );
  assert.ok(start);

  const cookie = start.headers.get("set-cookie")!.split(";")[0];
  const result = await handleRobloxIdentityRequest(
    new Request("https://api.example/api/identity/roblox/exchange", {
      method: "POST",
      headers: {
        authorization: "Bearer bobaks-access-token",
        cookie,
        "content-type": "application/json"
      },
      body: JSON.stringify({ code: "code", state: "wrong-state" })
    }),
    ENV,
    fetchImpl
  );

  assert.ok(result);
  assert.equal(result.status, 400);
  assert.match(await result.text(), /state/i);
  assert.deepEqual(calls, ["/auth/v1/user", "/auth/v1/user"]);
});

test("exchange reports a conflict when the Roblox identity is already linked to another Bobaks account", async () => {
  const fetchImpl = makeFetch({
    "/rest/v1/roblox_identities": async () =>
      response({ code: "23505", message: "duplicate key" }, 409)
  });

  const start = await handleRobloxIdentityRequest(
    new Request("https://api.example/api/identity/roblox/start", {
      method: "POST",
      headers: { authorization: "Bearer bobaks-access-token" }
    }),
    ENV,
    fetchImpl
  );
  assert.ok(start);

  const authorizeUrl = new URL((await start.json() as { authorizeUrl: string }).authorizeUrl);
  const cookie = start.headers.get("set-cookie")!.split(";")[0];

  const result = await handleRobloxIdentityRequest(
    new Request("https://api.example/api/identity/roblox/exchange", {
      method: "POST",
      headers: {
        authorization: "Bearer bobaks-access-token",
        cookie,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        code: "roblox-code-2",
        state: authorizeUrl.searchParams.get("state")
      })
    }),
    ENV,
    fetchImpl
  );

  assert.ok(result);
  assert.equal(result.status, 409);
  assert.match(await result.text(), /already connected/i);
  assert.match(result.headers.get("set-cookie") ?? "", /Max-Age=0/);
});

test("disconnect marks the signed-in user's Roblox identity revoked", async () => {
  let patchedBody: Record<string, unknown> | null = null;
  const fetchImpl = makeFetch({
    "/rest/v1/roblox_identities": async (_url, init) => {
      patchedBody = JSON.parse(String(init.body ?? "{}"));
      return response([{ user_id: "user-1", status: "revoked" }]);
    }
  });

  const result = await handleRobloxIdentityRequest(
    new Request("https://api.example/api/identity/roblox/disconnect", {
      method: "POST",
      headers: { authorization: "Bearer bobaks-access-token" }
    }),
    ENV,
    fetchImpl
  );

  assert.ok(result);
  assert.equal(result.status, 200);
  assert.deepEqual(patchedBody, { status: "revoked" });
});

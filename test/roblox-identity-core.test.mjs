import assert from "node:assert/strict";
import test from "node:test";
import { buildRobloxAuthorizeUrl, createPkceChallenge } from "../frontend/roblox-identity-core.mjs";

test("Roblox authorize URL uses OAuth 2.0 authorization code flow with PKCE", () => {
  const url = new URL(buildRobloxAuthorizeUrl({
    clientId: "client-123",
    redirectUri: "https://bobaks.example/account",
    state: "state-value",
    codeChallenge: "challenge-value",
    nonce: "nonce-value",
    scopes: ["openid", "profile"]
  }));

  assert.equal(url.origin, "https://apis.roblox.com");
  assert.equal(url.pathname, "/oauth/v1/authorize");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("client_id"), "client-123");
  assert.equal(url.searchParams.get("redirect_uri"), "https://bobaks.example/account");
  assert.equal(url.searchParams.get("scope"), "openid profile");
  assert.equal(url.searchParams.get("code_challenge"), "challenge-value");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("state"), "state-value");
  assert.equal(url.searchParams.get("nonce"), "nonce-value");
});

test("PKCE challenge is derived with SHA-256 and base64url encoding", async () => {
  const challenge = await createPkceChallenge("a".repeat(64));
  assert.match(challenge, /^[A-Za-z0-9_-]+$/);
  assert.equal(challenge.length, 43);
});

test("Roblox authorize helper rejects incomplete configuration", () => {
  assert.throws(
    () => buildRobloxAuthorizeUrl({ clientId: "client-123" }),
    /configuration is incomplete/
  );
});

const COOKIE_NAME = "__Host-bobaks_roblox_tx";
const COOKIE_MAX_AGE_SECONDS = 300;
const ROBLOX_AUTHORIZE_URL = "https://apis.roblox.com/oauth/v1/authorize";
const ROBLOX_TOKEN_URL = "https://apis.roblox.com/oauth/v1/token";
const ROBLOX_USERINFO_URL = "https://apis.roblox.com/oauth/v1/userinfo";

type JsonRecord = Record<string, unknown>;
type FetchLike = typeof fetch;

export interface RobloxIdentityEnv {
  SUPABASE_URL: string;
  SUPABASE_SECRET_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  ROBLOX_CLIENT_ID?: string;
  ROBLOX_CLIENT_SECRET?: string;
  ROBLOX_REDIRECT_URI?: string;
  ROBLOX_OAUTH_COOKIE_SECRET?: string;
}

function json(body: unknown, status = 200, extraHeaders: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extraHeaders }
  });
}

function serviceKey(env: RobloxIdentityEnv) {
  const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Missing Supabase server key.");
  return key;
}

function cookieHeader(value: string, maxAge: number) {
  return `${COOKIE_NAME}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

function clearCookie() {
  return cookieHeader("", 0);
}

function getBearer(request: Request) {
  const value = request.headers.get("authorization") || "";
  return /^Bearer\s+\S+$/i.test(value) ? value : "";
}

async function authenticatedSupabaseUser(
  request: Request,
  env: RobloxIdentityEnv,
  fetchImpl: FetchLike
): Promise<{ id: string; email?: string } | null> {
  const bearer = getBearer(request);
  if (!bearer) return null;

  const key = serviceKey(env);
  const response = await fetchImpl(`${env.SUPABASE_URL.replace(/\/$/, "")}/auth/v1/user`, {
    headers: {
      apikey: key,
      authorization: bearer,
      accept: "application/json"
    }
  });

  if (!response.ok) return null;
  const body = await response.json() as JsonRecord;
  return typeof body.id === "string" && body.id ? {
    id: body.id,
    email: typeof body.email === "string" ? body.email : undefined
  } : null;
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function signValue(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return base64Url(new Uint8Array(signature));
}

async function verifyValue(value: string, signature: string, secret: string) {
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"]
    );
    return await crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlDecode(signature),
      new TextEncoder().encode(value)
    );
  } catch {
    return false;
  }
}

async function createTransactionCookie(userId: string, redirectUri: string, secret: string) {
  const stateBytes = crypto.getRandomValues(new Uint8Array(32));
  const verifierBytes = crypto.getRandomValues(new Uint8Array(48));
  const state = bytesToHex(stateBytes);
  const verifier = base64Url(verifierBytes);
  const challengeDigest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier)
  );
  const challenge = base64Url(new Uint8Array(challengeDigest));
  const payload = base64Url(new TextEncoder().encode(JSON.stringify({
    userId,
    state,
    verifier,
    redirectUri,
    exp: Math.floor(Date.now() / 1000) + COOKIE_MAX_AGE_SECONDS
  })));
  const signature = await signValue(payload, secret);
  return {
    state,
    challenge,
    cookie: cookieHeader(`${payload}.${signature}`, COOKIE_MAX_AGE_SECONDS)
  };
}

function readCookie(request: Request) {
  const header = request.headers.get("cookie") || "";
  const pair = header.split(";").map(value => value.trim()).find(value => value.startsWith(COOKIE_NAME + "="));
  return pair ? pair.slice(COOKIE_NAME.length + 1) : "";
}

async function readTransactionCookie(request: Request, secret: string) {
  const value = readCookie(request);
  const dot = value.indexOf(".");
  if (dot <= 0) return null;
  const payloadEncoded = value.slice(0, dot);
  const signature = value.slice(dot + 1);
  if (!await verifyValue(payloadEncoded, signature, secret)) return null;

  try {
    const parsed = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadEncoded))) as JsonRecord;
    if (
      typeof parsed.userId !== "string" ||
      typeof parsed.state !== "string" ||
      typeof parsed.verifier !== "string" ||
      typeof parsed.redirectUri !== "string" ||
      typeof parsed.exp !== "number" ||
      parsed.exp <= Math.floor(Date.now() / 1000)
    ) return null;
    return {
      userId: parsed.userId,
      state: parsed.state,
      verifier: parsed.verifier,
      redirectUri: parsed.redirectUri
    };
  } catch {
    return null;
  }
}

function requiredConfig(env: RobloxIdentityEnv) {
  const clientId = String(env.ROBLOX_CLIENT_ID || "").trim();
  const clientSecret = String(env.ROBLOX_CLIENT_SECRET || "").trim();
  const redirectUri = String(env.ROBLOX_REDIRECT_URI || "").trim();
  const cookieSecret = String(env.ROBLOX_OAUTH_COOKIE_SECRET || "").trim();
  if (!clientId || !clientSecret || !redirectUri || cookieSecret.length < 32) return null;
  return { clientId, clientSecret, redirectUri, cookieSecret };
}

async function startConnection(
  request: Request,
  env: RobloxIdentityEnv,
  fetchImpl: FetchLike
) {
  const config = requiredConfig(env);
  if (!config) return json({ error: "Roblox identity connection is not configured." }, 503);

  const user = await authenticatedSupabaseUser(request, env, fetchImpl);
  if (!user) return json({ error: "Authentication required." }, 401);

  const transaction = await createTransactionCookie(user.id, config.redirectUri, config.cookieSecret);
  const url = new URL(ROBLOX_AUTHORIZE_URL);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("scope", "openid profile");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", transaction.state);
  url.searchParams.set("code_challenge", transaction.challenge);
  url.searchParams.set("code_challenge_method", "S256");

  return json({ authorizeUrl: url.toString() }, 200, { "set-cookie": transaction.cookie });
}

async function exchangeConnection(
  request: Request,
  env: RobloxIdentityEnv,
  fetchImpl: FetchLike
) {
  const config = requiredConfig(env);
  if (!config) return json({ error: "Roblox identity connection is not configured." }, 503);

  const user = await authenticatedSupabaseUser(request, env, fetchImpl);
  if (!user) return json({ error: "Authentication required." }, 401);

  const transaction = await readTransactionCookie(request, config.cookieSecret);
  if (!transaction || transaction.userId !== user.id) {
    return json({ error: "Roblox identity state is invalid or expired." }, 400);
  }

  let input: JsonRecord;
  try {
    const body = await request.json() as unknown;
    if (!body || typeof body !== "object") throw new Error("invalid");
    input = body as JsonRecord;
  } catch {
    return json({ error: "Invalid request body." }, 400, { "set-cookie": clearCookie() });
  }

  const code = typeof input.code === "string" ? input.code.trim() : "";
  const state = typeof input.state === "string" ? input.state.trim() : "";
  if (!code || code.length > 2048 || !state || state !== transaction.state) {
    return json({ error: "Roblox identity state is invalid or expired." }, 400, { "set-cookie": clearCookie() });
  }

  const form = new URLSearchParams();
  form.set("grant_type", "authorization_code");
  form.set("client_id", config.clientId);
  form.set("code", code);
  form.set("code_verifier", transaction.verifier);
  form.set("redirect_uri", transaction.redirectUri);

  const tokenResponse = await fetchImpl(ROBLOX_TOKEN_URL, {
    method: "POST",
    headers: {
      authorization: "Basic " + btoa(`${config.clientId}:${config.clientSecret}`),
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json"
    },
    body: form.toString()
  });

  if (!tokenResponse.ok) {
    return json({ error: "Roblox authorization could not be completed. Please try again." }, 502, {
      "set-cookie": clearCookie()
    });
  }

  const tokenBody = await tokenResponse.json() as JsonRecord;
  const accessToken = typeof tokenBody.access_token === "string" ? tokenBody.access_token : "";
  if (!accessToken) {
    return json({ error: "Roblox authorization returned no access token." }, 502, {
      "set-cookie": clearCookie()
    });
  }

  const userInfoResponse = await fetchImpl(ROBLOX_USERINFO_URL, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json"
    }
  });

  if (!userInfoResponse.ok) {
    return json({ error: "Roblox identity could not be verified." }, 502, {
      "set-cookie": clearCookie()
    });
  }

  const userInfo = await userInfoResponse.json() as JsonRecord;
  const subject = typeof userInfo.sub === "string" ? userInfo.sub.trim() : "";
  if (!/^\d+$/.test(subject) || BigInt(subject) > 9223372036854775807n) {
    return json({ error: "Roblox returned an invalid user identity." }, 502, {
      "set-cookie": clearCookie()
    });
  }

  const key = serviceKey(env);
  const identityResponse = await fetchImpl(
    `${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/roblox_identities?on_conflict=user_id`,
    {
      method: "POST",
      headers: {
        apikey: key,
        authorization: key.startsWith("sb_") ? "" : `Bearer ${key}`,
        "content-type": "application/json",
        prefer: "resolution=merge-duplicates,return=representation"
      },
      body: JSON.stringify({
        user_id: user.id,
        roblox_user_id: subject,
        provider_subject: subject,
        username: typeof userInfo.preferred_username === "string" ? userInfo.preferred_username : null,
        display_name: typeof userInfo.name === "string"
          ? userInfo.name
          : typeof userInfo.nickname === "string" ? userInfo.nickname : null,
        profile_url: typeof userInfo.profile === "string" ? userInfo.profile : null,
        avatar_url: typeof userInfo.picture === "string" ? userInfo.picture : null,
        status: "connected",
        last_verified_at: new Date().toISOString()
      })
    }
  );

  if (identityResponse.status === 409) {
    return json({ error: "That Roblox account is already connected to another Bobaks account." }, 409, {
      "set-cookie": clearCookie()
    });
  }

  if (!identityResponse.ok) {
    return json({ error: "Roblox identity could not be saved." }, 502, { "set-cookie": clearCookie() });
  }

  const rows = await identityResponse.json() as unknown;
  const identity = Array.isArray(rows) ? rows[0] : null;
  return json(identity && typeof identity === "object" ? identity : {
    user_id: user.id,
    roblox_user_id: Number(subject),
    provider_subject: subject,
    status: "connected"
  }, 200, { "set-cookie": clearCookie() });
}

async function disconnectConnection(
  request: Request,
  env: RobloxIdentityEnv,
  fetchImpl: FetchLike
) {
  const user = await authenticatedSupabaseUser(request, env, fetchImpl);
  if (!user) return json({ error: "Authentication required." }, 401);

  const key = serviceKey(env);
  const response = await fetchImpl(
    `${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/roblox_identities?user_id=eq.${encodeURIComponent(user.id)}`,
    {
      method: "PATCH",
      headers: {
        apikey: key,
        authorization: key.startsWith("sb_") ? "" : `Bearer ${key}`,
        "content-type": "application/json",
        prefer: "return=representation"
      },
      body: JSON.stringify({ status: "revoked", updated_at: new Date().toISOString() })
    }
  );

  if (!response.ok) return json({ error: "Roblox identity could not be disconnected." }, 502);
  const rows = await response.json() as unknown;
  return json(Array.isArray(rows) && rows[0] ? rows[0] : { user_id: user.id, status: "revoked" });
}

export async function handleRobloxIdentityRequest(
  request: Request,
  env: RobloxIdentityEnv,
  fetchImpl: FetchLike = fetch
): Promise<Response | null> {
  const path = new URL(request.url).pathname.replace(/\/+$/, "");
  if (!path.startsWith("/api/identity/roblox/")) return null;

  if (request.method !== "POST") {
    return json({ error: "Method not allowed." }, 405, { allow: "POST" });
  }

  try {
    if (path === "/api/identity/roblox/start") return startConnection(request, env, fetchImpl);
    if (path === "/api/identity/roblox/exchange") return exchangeConnection(request, env, fetchImpl);
    if (path === "/api/identity/roblox/disconnect") return disconnectConnection(request, env, fetchImpl);
    return json({ error: "Not found." }, 404);
  } catch (error) {
    console.error("Roblox identity request failed:", error);
    return json({ error: "Roblox identity service is temporarily unavailable." }, 503);
  }
}

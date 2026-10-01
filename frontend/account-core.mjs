export const SESSION_STORAGE_KEY = "bobaks.auth.session.v1";

const REFRESH_BUFFER_SECONDS = 60;

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    }
  };
}

function getDefaultStorage() {
  try {
    if (globalThis.localStorage) return globalThis.localStorage;
  } catch {
    // Storage may be unavailable in privacy-restricted browser contexts.
  }
  return createMemoryStorage();
}

function normalizeBaseUrl(value) {
  const url = new URL(String(value ?? "").trim());
  url.pathname = url.pathname.replace(/\/$/, "");
  if (!/^https?:$/.test(url.protocol)) {
    throw new Error("Supabase URL must use HTTP or HTTPS.");
  }
  return url.toString().replace(/\/$/, "");
}

function normalizeSession(session) {
  if (!session || typeof session !== "object") return null;

  const accessToken = String(session.access_token ?? "");
  const refreshToken = String(session.refresh_token ?? "");
  const user = session.user && typeof session.user === "object"
    ? session.user
    : null;

  if (!accessToken || !refreshToken || !user || !user.id) {
    return null;
  }

  const expiresAt = Number(session.expires_at);
  const expiresIn = Number(session.expires_in);

  return {
    ...session,
    access_token: accessToken,
    refresh_token: refreshToken,
    user,
    expires_at: Number.isFinite(expiresAt)
      ? expiresAt
      : Number.isFinite(expiresIn)
        ? Math.floor(Date.now() / 1000) + expiresIn
        : null
  };
}

function parseResponseBody(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function readResponseBody(response) {
  const text = await response.text();
  return {
    text,
    json: parseResponseBody(text)
  };
}

function createRequestError(response, body) {
  const payload = body?.json;
  const message =
    (payload && typeof payload === "object" && (
      payload.msg ||
      payload.message ||
      payload.error_description ||
      payload.error
    )) ||
    body?.text ||
    "Authentication request failed.";

  const error = new Error(String(message));
  error.status = response.status;
  error.code = payload && typeof payload === "object"
    ? (payload.error_code ?? payload.code ?? null)
    : null;
  return error;
}

function normalizeGameId(gameId) {
  const value = String(gameId ?? "").trim();
  if (!/^\d{1,20}$/.test(value)) {
    throw new Error("Invalid game ID.");
  }
  return value;
}

function normalizeEmail(email) {
  const value = String(email ?? "").trim();
  if (!value || !value.includes("@")) {
    throw new Error("Enter a valid email address.");
  }
  return value;
}

function buildRequestHeaders(publishableKey, accessToken, extraHeaders) {
  const headers = new Headers(extraHeaders || {});
  headers.set("apikey", publishableKey);
  headers.set("accept", "application/json");
  if (accessToken) headers.set("authorization", "Bearer " + accessToken);
  return headers;
}

export function createAuthClient({
  supabaseUrl,
  publishableKey,
  storage = getDefaultStorage(),
  fetchImpl = globalThis.fetch
} = {}) {
  const baseUrl = normalizeBaseUrl(supabaseUrl);
  const key = String(publishableKey ?? "").trim();

  if (!key) throw new Error("Supabase publishable key is required.");
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required.");

  const store = storage && typeof storage.getItem === "function"
    ? storage
    : createMemoryStorage();
  const listeners = new Set();
  let refreshPromise = null;

  function emit(event, session = null) {
    for (const listener of listeners) {
      try {
        listener(event, session);
      } catch {
        // Subscriber errors must not break authentication state updates.
      }
    }
  }

  function readStoredSession() {
    const raw = store.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;

    try {
      const session = normalizeSession(JSON.parse(raw));
      if (!session) {
        store.removeItem(SESSION_STORAGE_KEY);
      }
      return session;
    } catch {
      store.removeItem(SESSION_STORAGE_KEY);
      return null;
    }
  }

  function writeSession(session) {
    const normalized = normalizeSession(session);
    if (!normalized) {
      store.removeItem(SESSION_STORAGE_KEY);
      return null;
    }
    store.setItem(SESSION_STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  }

  function clearSession() {
    store.removeItem(SESSION_STORAGE_KEY);
  }

  async function authRequest(path, {
    method = "GET",
    body,
    accessToken,
    headers
  } = {}) {
    const requestHeaders = buildRequestHeaders(key, accessToken, headers);
    if (body !== undefined) requestHeaders.set("content-type", "application/json");

    const response = await fetchImpl(baseUrl + path, {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body)
    });

    const parsed = await readResponseBody(response);
    if (!response.ok) throw createRequestError(response, parsed);
    return parsed.json;
  }

  async function restRequest(path, {
    method = "GET",
    body,
    accessToken,
    headers
  } = {}) {
    if (!path.startsWith("/")) throw new Error("Supabase REST path must start with /.");

    const requestHeaders = buildRequestHeaders(key, accessToken, headers);
    if (body !== undefined) requestHeaders.set("content-type", "application/json");

    const response = await fetchImpl(baseUrl + "/rest/v1" + path, {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body)
    });

    const parsed = await readResponseBody(response);
    if (!response.ok) throw createRequestError(response, parsed);

    return {
      data: parsed.json,
      response
    };
  }

  async function signUp({
    email,
    password,
    displayName,
    emailRedirectTo
  } = {}) {
    const body = {
      email: normalizeEmail(email),
      password: String(password ?? "")
    };

    if (!body.password) throw new Error("Password is required.");

    if (displayName != null && String(displayName).trim()) {
      body.data = {
        display_name: String(displayName).trim().slice(0, 80)
      };
    }

    if (emailRedirectTo) body.email_redirect_to = String(emailRedirectTo);

    const payload = await authRequest("/auth/v1/signup", {
      method: "POST",
      body
    });

    const session = writeSession(payload?.session);
    emit(session ? "SIGNED_IN" : "SIGNED_UP", session);

    return {
      user: payload?.user ?? null,
      session
    };
  }

  async function signIn({ email, password } = {}) {
    const payload = await authRequest("/auth/v1/token?grant_type=password", {
      method: "POST",
      body: {
        email: normalizeEmail(email),
        password: String(password ?? "")
      }
    });

    const session = writeSession(payload);
    if (!session) throw new Error("Sign-in succeeded but no session was returned.");

    emit("SIGNED_IN", session);

    return {
      user: session.user,
      session
    };
  }

  async function refreshSession() {
    if (refreshPromise) return refreshPromise;

    const existing = readStoredSession();
    const refreshToken = String(existing?.refresh_token ?? "");
    if (!refreshToken) {
      clearSession();
      return null;
    }

    refreshPromise = (async () => {
      const payload = await authRequest("/auth/v1/token?grant_type=refresh_token", {
        method: "POST",
        body: { refresh_token: refreshToken }
      });

      const session = writeSession(payload);
      if (!session) {
        clearSession();
        throw new Error("Session refresh returned no usable session.");
      }

      emit("TOKEN_REFRESHED", session);
      return session;
    })().finally(() => {
      refreshPromise = null;
    });

    return refreshPromise;
  }

  async function getSession() {
    const session = readStoredSession();
    if (!session) return null;

    const expiresAt = Number(session.expires_at);
    if (!Number.isFinite(expiresAt)) return session;

    const now = Math.floor(Date.now() / 1000);
    if (expiresAt - now > REFRESH_BUFFER_SECONDS) return session;

    try {
      return await refreshSession();
    } catch {
      clearSession();
      emit("SIGNED_OUT", null);
      return null;
    }
  }

  async function getUser() {
    let session = await getSession();
    if (!session) throw new Error("Authentication required.");

    try {
      const payload = await authRequest("/auth/v1/user", {
        accessToken: session.access_token
      });
      return payload;
    } catch (error) {
      if (error?.status !== 401 || !session.refresh_token) throw error;

      session = await refreshSession();
      if (!session) throw new Error("Authentication required.");

      const payload = await authRequest("/auth/v1/user", {
        accessToken: session.access_token
      });
      return payload;
    }
  }

  async function signOut() {
    const session = readStoredSession();

    try {
      if (session?.access_token) {
        await authRequest("/auth/v1/logout", {
          method: "POST",
          accessToken: session.access_token
        });
      }
    } finally {
      clearSession();
      emit("SIGNED_OUT", null);
    }
  }

  async function resetPasswordForEmail(email, redirectTo) {
    const body = { email: normalizeEmail(email) };
    if (redirectTo) body.redirect_to = String(redirectTo);

    await authRequest("/auth/v1/recover", {
      method: "POST",
      body
    });
  }

  async function authenticatedFetch(path, options = {}) {
    let session = await getSession();
    if (!session) throw new Error("Authentication required.");

    try {
      return await restRequest(path, {
        ...options,
        accessToken: session.access_token
      });
    } catch (error) {
      if (error?.status !== 401 || !session.refresh_token) throw error;

      session = await refreshSession();
      if (!session) throw new Error("Authentication required.");

      return restRequest(path, {
        ...options,
        accessToken: session.access_token
      });
    }
  }

  async function getProfile() {
    const user = await getUser();
    const id = encodeURIComponent(String(user.id));
    const result = await authenticatedFetch(
      "/profiles?select=id,display_name,avatar_url,is_public,created_at,updated_at&id=eq." + id + "&limit=1"
    );
    return Array.isArray(result.data) ? (result.data[0] ?? null) : null;
  }

  async function updateProfile(patch = {}) {
    const user = await getUser();
    const allowed = {};

    if (Object.prototype.hasOwnProperty.call(patch, "display_name")) {
      const value = patch.display_name == null ? null : String(patch.display_name).trim().slice(0, 80);
      allowed.display_name = value || null;
    }

    if (Object.prototype.hasOwnProperty.call(patch, "avatar_url")) {
      allowed.avatar_url = patch.avatar_url == null ? null : String(patch.avatar_url).trim().slice(0, 2048);
    }

    if (Object.prototype.hasOwnProperty.call(patch, "is_public")) {
      allowed.is_public = Boolean(patch.is_public);
    }

    if (!Object.keys(allowed).length) return getProfile();

    const id = encodeURIComponent(String(user.id));
    const result = await authenticatedFetch("/profiles?id=eq." + id, {
      method: "PATCH",
      headers: { prefer: "return=representation" },
      body: allowed
    });

    return Array.isArray(result.data) ? (result.data[0] ?? null) : null;
  }

  async function listWatchlist() {
    const result = await authenticatedFetch(
      "/user_watchlist?select=game_id,created_at&order=created_at.desc"
    );
    return Array.isArray(result.data) ? result.data : [];
  }

  async function addWatchlistGame(gameId) {
    const user = await getUser();
    const result = await authenticatedFetch("/user_watchlist", {
      method: "POST",
      headers: {
        prefer: "resolution=merge-duplicates,return=representation"
      },
      body: {
        user_id: user.id,
        game_id: normalizeGameId(gameId)
      }
    });
    return Array.isArray(result.data) ? (result.data[0] ?? null) : null;
  }

  async function removeWatchlistGame(gameId) {
    const user = await getUser();
    const result = await authenticatedFetch(
      "/user_watchlist?user_id=eq." + encodeURIComponent(String(user.id)) +
      "&game_id=eq." + encodeURIComponent(normalizeGameId(gameId)),
      { method: "DELETE", headers: { prefer: "return=representation" } }
    );
    return Array.isArray(result.data) ? result.data : [];
  }

  async function getAlertPreferences() {
    const user = await getUser();
    const result = await authenticatedFetch(
      "/user_alert_preferences?select=user_id,alerts_enabled,top10_enabled,new_peak_enabled,rank_jump_enabled,rank_jump_threshold,created_at,updated_at&user_id=eq." +
      encodeURIComponent(String(user.id)) + "&limit=1"
    );
    return Array.isArray(result.data) ? (result.data[0] ?? null) : null;
  }

  async function updateAlertPreferences(patch = {}) {
    const user = await getUser();
    const allowed = {
      user_id: user.id
    };

    for (const field of [
      "alerts_enabled",
      "top10_enabled",
      "new_peak_enabled",
      "rank_jump_enabled"
    ]) {
      if (Object.prototype.hasOwnProperty.call(patch, field)) {
        allowed[field] = Boolean(patch[field]);
      }
    }

    if (Object.prototype.hasOwnProperty.call(patch, "rank_jump_threshold")) {
      const value = Number(patch.rank_jump_threshold);
      if (!Number.isInteger(value) || value < 1 || value > 100) {
        throw new Error("Rank jump threshold must be an integer from 1 to 100.");
      }
      allowed.rank_jump_threshold = value;
    }

    const result = await authenticatedFetch("/user_alert_preferences", {
      method: "POST",
      headers: {
        prefer: "resolution=merge-duplicates,return=representation"
      },
      body: allowed
    });

    return Array.isArray(result.data) ? (result.data[0] ?? null) : null;
  }

  async function listSavedComparisons() {
    const result = await authenticatedFetch(
      "/saved_comparisons?select=id,game_id_a,game_id_b,created_at&order=created_at.desc"
    );
    return Array.isArray(result.data) ? result.data : [];
  }

  async function saveComparison(gameIdA, gameIdB) {
    const user = await getUser();
    const a = normalizeGameId(gameIdA);
    const b = normalizeGameId(gameIdB);
    if (a === b) throw new Error("A comparison needs two different games.");

    const result = await authenticatedFetch("/saved_comparisons", {
      method: "POST",
      headers: {
        prefer: "resolution=merge-duplicates,return=representation"
      },
      body: {
        user_id: user.id,
        game_id_a: a,
        game_id_b: b
      }
    });

    return Array.isArray(result.data) ? (result.data[0] ?? null) : null;
  }

  async function removeSavedComparison(id) {
    const value = String(id ?? "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(value)) throw new Error("Invalid saved comparison ID.");

    const user = await getUser();
    const result = await authenticatedFetch(
      "/saved_comparisons?id=eq." + encodeURIComponent(value) +
      "&user_id=eq." + encodeURIComponent(String(user.id)),
      { method: "DELETE", headers: { prefer: "return=representation" } }
    );
    return Array.isArray(result.data) ? result.data : [];
  }

  function onAuthStateChange(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("Auth listener must be a function.");
    }

    listeners.add(listener);
    return {
      data: {
        subscription: {
          unsubscribe() {
            listeners.delete(listener);
          }
        }
      }
    };
  }

  return {
    signUp,
    signIn,
    signOut,
    refreshSession,
    getSession,
    getUser,
    resetPasswordForEmail,
    authenticatedFetch,
    getProfile,
    updateProfile,
    listWatchlist,
    addWatchlistGame,
    removeWatchlistGame,
    getAlertPreferences,
    updateAlertPreferences,
    listSavedComparisons,
    saveComparison,
    removeSavedComparison,
    onAuthStateChange,
    clearSession
  };
}

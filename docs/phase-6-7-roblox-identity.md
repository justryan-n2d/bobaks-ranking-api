# Phase 6.7 Roblox identity connection

Bobaks accounts and Roblox identities are separate. A Roblox connection is started only by a signed-in Bobaks account and uses Roblox authorization code + PKCE.

## Cloudflare API configuration

The API Worker must have these values configured before the connection button is enabled in production:

- `ROBLOX_CLIENT_ID`: Roblox OAuth application client ID.
- `ROBLOX_CLIENT_SECRET`: Roblox OAuth application client secret. Keep this in a Cloudflare secret.
- `ROBLOX_REDIRECT_URI`: exact public Bobaks callback URL, for example `https://<bobaks-web-origin>/account/roblox-callback`.
- `ROBLOX_OAUTH_COOKIE_SECRET`: random server-only secret of at least 32 characters.

The API already has its Supabase server key configuration. No Roblox access token or refresh token is written to the database.

## Flow

1. The signed-in Bobaks browser calls `POST /api/identity/roblox/start`.
2. The API validates the Bobaks Supabase bearer token, generates state + PKCE verifier, and sets a signed, HttpOnly, Secure, SameSite=Lax transaction cookie.
3. The browser is redirected to Roblox with the `openid profile` scopes.
4. Roblox returns an authorization code and the same state to `/account/roblox-callback`.
5. The browser calls `POST /api/identity/roblox/exchange` through the same-origin web proxy.
6. The API verifies the signed transaction cookie, state, and Bobaks user, exchanges the code at Roblox, then calls Roblox UserInfo.
7. Bobaks stores only the verified Roblox identity fields: subject/ID, username, display name, profile URL, avatar URL, connection status, and verification timestamps.
8. A unique constraint prevents the same Roblox account from being connected to two Bobaks accounts.
9. Disconnect marks the identity revoked and the UI clears Roblox visibility permissions.

## Security boundary

The Roblox client secret exists only on the API Worker. PKCE verifier and transaction state are not stored in localStorage. The browser never receives a Roblox access token or refresh token.

Roblox documents that authorization codes are short-lived and single-use, and that `sub` is the stable user identity while usernames/display names can change. Bobaks therefore treats the Roblox subject as the permanent external key.

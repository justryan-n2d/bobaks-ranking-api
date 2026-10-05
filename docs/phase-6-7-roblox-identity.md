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

## Migration reconciliation

The production Supabase project was already migrated before this API PR was finalized. The repository therefore tracks the migration versions that production reports as applied instead of attempting to re-run them.

- `20261001012216_accounts_identity_foundation` is already applied and is now tracked in this repository.
- `20261001012335_normalize_saved_comparison_identity` is already applied and is now tracked in this repository.
- `20261001012510_account_foreign_key_indexes` is already applied and is now tracked in this repository.
- The applied Roblox identity migration is `20261001015236_roblox_identity_foundation`. The PR's former `20261001030000_roblox_identity_foundation` filename was a duplicate timestamp and has been removed.
- `20261005032805_identity_visibility_preferences` is already applied and is now tracked in this repository.
- Production also already has the watchlist UPDATE policy represented by `20261001050000_watchlist_upsert_permissions`, but that version is not present in the reported production migration history. The migration remains in source control so fresh environments reproduce the verified production behavior; it must not be blindly re-applied to production as a second schema migration.

This reconciliation is repository/history alignment only. No already-applied identity migration is re-executed as part of PR #123.

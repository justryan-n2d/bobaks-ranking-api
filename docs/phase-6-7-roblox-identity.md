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

1. The signed-in Bobaks browser calls `POST /api/identity/roblox/start` through the same-origin web proxy. The proxy must forward the response's `Set-Cookie` header to the browser so the host-only `__Host-` transaction cookie belongs to the web origin.
2. The API validates the Bobaks Supabase bearer token, generates state + PKCE verifier, and sets a signed, HttpOnly, Secure, SameSite=Lax transaction cookie.
3. The browser is redirected to Roblox with the `openid profile` scopes.
4. Roblox returns an authorization code and the same state to `/account/roblox-callback`.
5. After the Roblox callback returns to the web origin, the browser calls `POST /api/identity/roblox/exchange` through the same-origin web proxy, which forwards the browser cookie and Bobaks bearer token to the API.
6. The API verifies the signed transaction cookie, state, and Bobaks user, exchanges the code at Roblox, then calls Roblox UserInfo.
7. Bobaks stores only the verified Roblox identity fields: subject/ID, username, display name, profile URL, avatar URL, connection status, and verification timestamps.
8. Partial unique constraints prevent the same connected Roblox account from being connected to two Bobaks accounts while allowing a revoked identity to be connected later.
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
- `20261005151219_roblox_identity_revoked_uniqueness` is applied in production and is tracked with the same migration version in this repository. It scopes Roblox identity uniqueness to `status = 'connected'` so revoked history does not block later reconnection.
- `20261001050000_watchlist_upsert_permissions` is now recorded in the production migration history. The watchlist UPDATE policy was already present, so the remote migration ledger was repaired by marking this migration as applied without re-running its SQL.

This is now a clean repository/production migration-history alignment. No schema or data change was made by the ledger repair, and no already-applied identity migration is re-executed.

## Revocation lifecycle

A disconnected identity row is retained as historical state and marked `revoked`. The `roblox_user_id` and `provider_subject` uniqueness indexes only cover rows with `status = 'connected'`, so a later Bobaks account can connect the same Roblox account without deleting the original history.

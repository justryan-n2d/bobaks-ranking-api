# Private Analytics Dashboard Access

The Phase 6.5 private analytics dashboard is implemented at:

- /admin/analytics
- /admin/api/analytics

The route is fail-closed and validates Cloudflare Access JWTs. Final access control is enforced by the Cloudflare Access application policy.

## Cloudflare Access setup

Create a self-hosted Access application for the production Worker and protect:

`https://bobaks-ranking-api.bobaksranking.workers.dev/admin/*`

Create an Allow policy whose Include rule contains only the owner email and approved administrator email addresses. Do not use Everyone or all valid email login methods.

After creating the application, copy the Application Audience (AUD) tag from the application's additional settings.

The Worker also needs:

- `CF_ACCESS_TEAM_DOMAIN`: the Cloudflare Access team domain, such as `https://<team-name>.cloudflareaccess.com`
- `CF_ACCESS_AUD`: the application's AUD tag
- `CLOUDFLARE_ACCOUNT_ID`: the Cloudflare account ID
- `CLOUDFLARE_ANALYTICS_API_TOKEN`: a token with Account Analytics Read permission

The deployment workflow already syncs the account ID and analytics read token from existing GitHub Actions secrets. It will also sync `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` when those GitHub secrets are configured.

## Verification checklist

1. Owner signs in through Cloudflare Access and /admin/analytics loads.
2. An approved administrator signs in and /admin/analytics loads.
3. A non-approved identity is denied by the Access policy.
4. A request without `Cf-Access-Jwt-Assertion` receives HTTP 401 from the Worker when it reaches the Worker.
5. A forged, expired, wrong-issuer, or wrong-audience JWT receives HTTP 403.
6. Direct requests to /admin/api/analytics are subject to the same authentication checks.
7. The browser never receives the Analytics API token.
8. The dashboard response is private/no-store and noindex.
9. /robots.txt disallows /admin/.

Do not place analytics credentials in frontend JavaScript, HTML, or public environment variables.

# Production Health Monitoring

Phase 4 Part 1 provides a lightweight operational health layer without adding a paid monitoring service.

## Checks

The API exposes two health levels:

- `GET /api/health`: liveness and Supabase connectivity.
- `GET /api/health/deep`: operational readiness across the database, collection pipeline, daily summaries, rankings, and historical recovery.

The collector exposes:

- `GET /health`: Worker liveness, Supabase connectivity, and collection freshness.

## Thresholds

Collection freshness is considered healthy when the latest successful or partial collection started within 15 minutes.

Daily summary freshness is considered healthy when the latest successful summary started within 26 hours.

Ranking health requires the audit to pass, all four ranking periods to contain 100 rows, and the newest live snapshot to remain within 15 minutes.

Historical recovery health requires zero recoverable daily-summary gaps.

## Automated monitoring

GitHub Actions runs `.github/workflows/production-health.yml` every 15 minutes and can also be started manually.

A failing check causes the workflow run to fail. GitHub Actions notifications can then surface the incident through the repository's configured notification settings.

## Failure detection and alerting

Phase 4 Part 4 adds explicit failure telemetry to the API deep-health response. The API reports collection failures and ranking-refresh failures from the last 30 minutes, plus stale ranking-refresh attempts.

The collector records each ranking refresh as `pending`, `success`, or `failed` on the collection run. A refresh failure does not invalidate the collected snapshots.

GitHub Actions runs `.github/workflows/production-health.yml` every 15 minutes. The separate `.github/workflows/production-alerting.yml` workflow listens for that monitor's completion, creates one open `🚨 Bobaks production incident` issue when a health run fails, and closes that issue after a later health run succeeds. This turns transient failures into a visible incident record instead of relying only on the live health page.

## Current R2 status

The backup archive remains intentionally paused while R2 activation is deferred. Production health monitoring does not depend on R2.

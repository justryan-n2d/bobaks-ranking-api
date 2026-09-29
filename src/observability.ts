export interface ObservabilityRun {
  startedAt?: unknown;
  finishedAt?: unknown;
  status?: unknown;
  gamesChecked?: unknown;
  gamesUpdated?: unknown;
  errors?: unknown;
  rankingRefreshStatus?: unknown;
  rankingRefreshStartedAt?: unknown;
  rankingRefreshFinishedAt?: unknown;
}

export interface DurationSummary {
  count: number;
  avg: number | null;
  p50: number | null;
  p95: number | null;
  max: number | null;
}

export interface ObservabilitySummary {
  windowHours: number;
  generatedAt: string;
  runs: {
    total: number;
    success: number;
    partial: number;
    failed: number;
    completionRate: number;
    fullSuccessRate: number;
  };
  games: {
    checked: number;
    updated: number;
    errors: number;
    updateRate: number | null;
  };
  collectionDurationSeconds: DurationSummary;
  rankingRefreshDurationSeconds: DurationSummary;
  rankingRefresh: {
    success: number;
    failed: number;
    pending: number;
    unknown: number;
    successRate: number | null;
  };
  schedule: {
    expectedIntervalSeconds: number;
    largestObservedGapSeconds: number | null;
  };
  latest: {
    status: string | null;
    startedAt: string | null;
    finishedAt: string | null;
    durationSeconds: number | null;
    gamesChecked: number;
    gamesUpdated: number;
    errors: number;
    rankingRefreshStatus: string | null;
    rankingRefreshStartedAt: string | null;
    rankingRefreshFinishedAt: string | null;
    rankingRefreshDurationSeconds: number | null;
  };
}

const EXPECTED_COLLECTION_INTERVAL_SECONDS = 10 * 60;

function finiteNumber(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function nonNegativeInteger(value: unknown): number {
  return Math.max(0, Math.round(finiteNumber(value)));
}

function parseTimestamp(value: unknown): number | null {
  if (value == null || value === "") return null;
  const timestamp = Date.parse(String(value));
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isoTimestamp(value: unknown): string | null {
  const timestamp = parseTimestamp(value);
  return timestamp == null ? null : new Date(timestamp).toISOString();
}

function durationSeconds(start: unknown, finish: unknown): number | null {
  const startedAt = parseTimestamp(start);
  const finishedAt = parseTimestamp(finish);
  if (startedAt == null || finishedAt == null || finishedAt < startedAt) return null;
  return Math.round((finishedAt - startedAt) / 1000);
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil(p * sorted.length));
  return sorted[rank - 1];
}

function summarizeDurations(values: number[]): DurationSummary {
  if (!values.length) {
    return { count: 0, avg: null, p50: null, p95: null, max: null };
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    count: values.length,
    avg: total / values.length,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max: Math.max(...values)
  };
}

function boundedRate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

export function summarizeObservability(
  rows: ObservabilityRun[],
  windowHours: number,
  nowMs = Date.now()
): ObservabilitySummary {
  const collectionDurations: number[] = [];
  const rankingRefreshDurations: number[] = [];
  const startedAtMs: number[] = [];

  let success = 0;
  let partial = 0;
  let failed = 0;
  let checked = 0;
  let updated = 0;
  let errors = 0;
  let refreshSuccess = 0;
  let refreshFailed = 0;
  let refreshPending = 0;
  let refreshUnknown = 0;

  for (const row of rows) {
    const status = String(row.status ?? "");
    if (status === "success") success++;
    else if (status === "partial") partial++;
    else if (status === "failed") failed++;

    checked += nonNegativeInteger(row.gamesChecked);
    updated += nonNegativeInteger(row.gamesUpdated);
    errors += nonNegativeInteger(row.errors);

    const collectionDuration = durationSeconds(row.startedAt, row.finishedAt);
    if (collectionDuration != null) collectionDurations.push(collectionDuration);

    const startedAt = parseTimestamp(row.startedAt);
    if (startedAt != null) startedAtMs.push(startedAt);

    const refreshStatus = String(row.rankingRefreshStatus ?? "");
    if (refreshStatus === "success") refreshSuccess++;
    else if (refreshStatus === "failed") refreshFailed++;
    else if (refreshStatus === "pending") refreshPending++;
    else refreshUnknown++;

    const refreshDuration = durationSeconds(
      row.rankingRefreshStartedAt,
      row.rankingRefreshFinishedAt
    );
    if (refreshDuration != null) rankingRefreshDurations.push(refreshDuration);
  }

  const orderedStartedAt = [...startedAtMs].sort((a, b) => a - b);
  let largestObservedGapSeconds: number | null = null;
  for (let i = 1; i < orderedStartedAt.length; i++) {
    const gapSeconds = Math.round((orderedStartedAt[i] - orderedStartedAt[i - 1]) / 1000);
    largestObservedGapSeconds =
      largestObservedGapSeconds == null
        ? gapSeconds
        : Math.max(largestObservedGapSeconds, gapSeconds);
  }

  const latest = rows[0];
  const latestCollectionDuration = latest
    ? durationSeconds(latest.startedAt, latest.finishedAt)
    : null;
  const latestRefreshDuration = latest
    ? durationSeconds(latest.rankingRefreshStartedAt, latest.rankingRefreshFinishedAt)
    : null;

  const total = success + partial + failed;
  const refreshKnown = refreshSuccess + refreshFailed;
  const generatedAt = new Date(nowMs).toISOString();

  return {
    windowHours,
    generatedAt,
    runs: {
      total,
      success,
      partial,
      failed,
      completionRate: boundedRate(success + partial, total) ?? 0,
      fullSuccessRate: boundedRate(success, total) ?? 0
    },
    games: {
      checked,
      updated,
      errors,
      updateRate: boundedRate(updated, checked)
    },
    collectionDurationSeconds: summarizeDurations(collectionDurations),
    rankingRefreshDurationSeconds: summarizeDurations(rankingRefreshDurations),
    rankingRefresh: {
      success: refreshSuccess,
      failed: refreshFailed,
      pending: refreshPending,
      unknown: refreshUnknown,
      successRate: boundedRate(refreshSuccess, refreshKnown)
    },
    schedule: {
      expectedIntervalSeconds: EXPECTED_COLLECTION_INTERVAL_SECONDS,
      largestObservedGapSeconds
    },
    latest: {
      status: latest ? String(latest.status ?? "") || null : null,
      startedAt: latest ? isoTimestamp(latest.startedAt) : null,
      finishedAt: latest ? isoTimestamp(latest.finishedAt) : null,
      durationSeconds: latestCollectionDuration,
      gamesChecked: latest ? nonNegativeInteger(latest.gamesChecked) : 0,
      gamesUpdated: latest ? nonNegativeInteger(latest.gamesUpdated) : 0,
      errors: latest ? nonNegativeInteger(latest.errors) : 0,
      rankingRefreshStatus: latest
        ? String(latest.rankingRefreshStatus ?? "") || null
        : null,
      rankingRefreshStartedAt: latest
        ? isoTimestamp(latest.rankingRefreshStartedAt)
        : null,
      rankingRefreshFinishedAt: latest
        ? isoTimestamp(latest.rankingRefreshFinishedAt)
        : null,
      rankingRefreshDurationSeconds: latestRefreshDuration
    }
  };
}

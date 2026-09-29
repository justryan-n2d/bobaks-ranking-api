const DAY_MS = 24 * 60 * 60 * 1000;

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function dayKey(value) {
  const time = Date.parse(String(value ?? ""));
  if (!Number.isFinite(time)) return null;
  return new Date(time).toISOString().slice(0, 10);
}

export function detectNewPeak(previous, current) {
  if (!previous || !current) return false;

  const previousPlayers = finiteNumber(previous.peakPlayers);
  const currentPlayers = finiteNumber(current.peakPlayers);
  if (previousPlayers == null || currentPlayers == null) return false;
  if (currentPlayers > previousPlayers) return true;
  if (currentPlayers !== previousPlayers) return false;

  const previousAt = Date.parse(String(previous.peakAt ?? ""));
  const currentAt = Date.parse(String(current.peakAt ?? ""));
  return Number.isFinite(previousAt) &&
    Number.isFinite(currentAt) &&
    currentAt > previousAt;
}

export function computeHistoricalMilestones(history = [], rankHistory = [], peak = {}) {
  const historyDates = history
    .map(row => dayKey(row?.timestamp ?? row?.date))
    .filter(Boolean)
    .sort();

  const rankRows = rankHistory
    .map(row => ({
      date: dayKey(row?.date ?? row?.timestamp),
      rank: finiteNumber(row?.rank)
    }))
    .filter(row => row.date && row.rank != null && row.rank > 0);

  const bestRank = rankRows.length
    ? Math.min(...rankRows.map(row => row.rank))
    : null;
  const bestRankAt = bestRank == null
    ? null
    : rankRows.find(row => row.rank === bestRank)?.date ?? null;
  const firstTop10 = rankRows
    .filter(row => row.rank <= 10)
    .map(row => row.date)
    .sort()[0] ?? null;

  const peakPlayers = finiteNumber(peak?.peakPlayers) ?? 0;
  const peakAt = peak?.peakAt ? String(peak.peakAt) : null;

  return {
    firstRecordedAt: historyDates[0] ?? null,
    bestRank,
    bestRankAt,
    firstTop10At: firstTop10,
    peakPlayers,
    peakAt,
    historicalDays: new Set(historyDates).size
  };
}

export function detectReturnAlerts({ previous, current, preferences = {} }) {
  if (!previous || !current) return [];

  const alerts = [];
  const previousRank = finiteNumber(previous.rank);
  const currentRank = finiteNumber(current.rank);

  if (
    preferences.top10 !== false &&
    previousRank != null &&
    currentRank != null &&
    previousRank > 10 &&
    currentRank <= 10
  ) {
    alerts.push({
      type: "top10",
      message: "Entered the Bobaks Top 10."
    });
  }

  if (
    preferences.newPeak !== false &&
    detectNewPeak(previous, current)
  ) {
    alerts.push({
      type: "newPeak",
      message: "Set a new recorded peak."
    });
  }

  if (
    preferences.bigMove !== false &&
    previousRank != null &&
    currentRank != null &&
    previousRank - currentRank >= 5
  ) {
    alerts.push({
      type: "bigMove",
      message: "Jumped 5 or more ranking places."
    });
  }

  return alerts;
}

export function mergePeakObservations(previous = {}, peaks = []) {
  const next = { ...previous };
  for (const peak of peaks) {
    const id = String(peak?.gameId ?? "");
    const players = finiteNumber(peak?.peakPlayers);
    if (!/^\d+$/.test(id) || players == null) continue;
    next[id] = {
      peakPlayers: players,
      peakAt: peak?.peakAt ? String(peak.peakAt) : null
    };
  }
  return next;
}

export function daysBetween(from, to) {
  const start = Date.parse(String(from ?? ""));
  const end = Date.parse(String(to ?? ""));
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, Math.floor((end - start) / DAY_MS));
}

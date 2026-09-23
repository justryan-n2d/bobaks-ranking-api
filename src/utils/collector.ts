export function parseCollectorIntervalMinutes(value: unknown): number {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) return 10;

  return Math.max(parsed, 5);
}

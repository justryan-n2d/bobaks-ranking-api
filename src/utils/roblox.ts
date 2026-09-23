export function parseRobloxDate(value: unknown): Date | null {
  if (value == null || value === "") return null;

  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parsePlayerCount(value: unknown): number {
  const count = Number(value);
  return Number.isFinite(count) ? Math.max(0, Math.round(count)) : 0;
}

export function parseUniverseId(value: unknown): string | null {
  if (value == null) return null;

  const text = String(value).trim();
  return /^\d+$/.test(text) && text !== "0" ? text : null;
}

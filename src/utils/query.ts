export function parseHistoryDays(value: unknown): number {
  if (value == null || value === "") return 7;

  const raw = Array.isArray(value) ? value[0] : value;
  const days = Number(raw);

  if (!Number.isInteger(days) || days < 1 || days > 365) {
    throw new Error("Invalid days");
  }

  return days;
}

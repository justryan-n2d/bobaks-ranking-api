export function parseHistoryDays(value: unknown): number {
  if (value == null || value === "") return 7;

  if (Array.isArray(value)) {
    if (value.length !== 1) throw new Error("Invalid days");
    value = value[0];
  }

  const days = Number(value);

  if (!Number.isInteger(days) || days < 1 || days > 365) {
    throw new Error("Invalid days");
  }

  return days;
}

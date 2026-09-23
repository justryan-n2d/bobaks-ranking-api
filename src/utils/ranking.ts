export type RankingPeriod = "live" | "week" | "month" | "year";

export function parseRankingPeriod(value: unknown): RankingPeriod {
  if (value == null) return "live";

  if (Array.isArray(value)) {
    if (value.length !== 1) throw new Error("Invalid period");
    value = value[0];
  }

  if (value === "live" || value === "week" || value === "month" || value === "year") {
    return value;
  }

  throw new Error("Invalid period");
}

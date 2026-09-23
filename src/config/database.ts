export function getDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.DATABASE_URL?.trim();

  if (!value) {
    throw new Error("DATABASE_URL is required");
  }

  return value;
}

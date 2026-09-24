import { Client } from 'pg';

export type WorkerEnv = {
  HYPERDRIVE: Hyperdrive;
  ASSETS: Fetcher;
  COLLECTOR_INTERVAL_MINUTES?: string;
};

export async function withDb<T>(env: WorkerEnv, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: env.HYPERDRIVE.connectionString });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export function jsonSafe(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    typeof item === 'bigint' ? item.toString() : item
  );
}

import { createApiHandler } from "./api";
import { withPgDatabase, type WorkerEnv } from "./db";

export type Env = WorkerEnv;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await withPgDatabase(env, async (db) => createApiHandler(db, { collectorIntervalMinutes: env.COLLECTOR_INTERVAL_MINUTES })(request));
    } catch (error) {
      console.error("Worker database connection failed:", error);
      return new Response(JSON.stringify({ error: "Database unavailable" }), { status: 503, headers: { "content-type": "application/json; charset=utf-8" } });
    }
  }
} satisfies ExportedHandler<Env>;
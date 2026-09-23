import { createApiHandler } from "./api";
import { withPgDatabase, type WorkerEnv } from "./db";
import { scheduled } from "./scheduled";

export type Env = WorkerEnv;

export default {
  scheduled,
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await withPgDatabase(env, async (db) => createApiHandler(db, { collectorIntervalMinutes: env.COLLECTOR_INTERVAL_MINUTES })(request));
    } catch (error) {
      console.error("Worker database connection failed:", error);
      const pathname = new URL(request.url).pathname.replace(/\/+$/, "") || "/";
      if (pathname === "/api/health") {
        return new Response(JSON.stringify({ ok: false, service: "bobaks-ranking-api", database: "unavailable", timestamp: new Date().toISOString() }), { status: 503, headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" } });
      }
      return new Response(JSON.stringify({ error: "Database unavailable" }), { status: 503, headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" } });
    }
  }
};
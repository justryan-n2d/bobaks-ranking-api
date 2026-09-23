import { collectOnceWithDb, type ScheduledCollectorDb } from "./collector";
import { withPgDatabase, type WorkerEnv } from "./db";

export type ScheduledDbOpener = (env: WorkerEnv, callback: (db: ScheduledCollectorDb) => Promise<void>) => Promise<void>;

export function createScheduledHandler(openDb: ScheduledDbOpener = withPgDatabase): (
  controller: ScheduledController,
  env: WorkerEnv,
  ctx: ExecutionContext
) => Promise<void> {
  return async (_controller, env, _ctx) => {
    try {
      await openDb(env, async (db) => {
        await collectOnceWithDb(db);
      });
    } catch (error) {
      console.error("Scheduled collector cycle failed:", error);
    }
  };
}

export const scheduled = createScheduledHandler();

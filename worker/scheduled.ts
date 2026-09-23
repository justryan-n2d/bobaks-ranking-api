import { collectOnceWithDb, type ScheduledCollectorDb } from "./collector";
import { withPgDatabase, type WorkerEnv } from "./db";

export type WorkerScheduledController = { cron?: string };
export type WorkerExecutionContext = { waitUntil(promise: Promise<unknown>): void };
export type ScheduledCollector = (db: ScheduledCollectorDb) => Promise<void>;
export type ScheduledDbOpener = (
  env: WorkerEnv,
  callback: (db: ScheduledCollectorDb) => Promise<void>
) => Promise<void>;

export function createScheduledHandler(
  openDb: ScheduledDbOpener = withPgDatabase,
  runCollector: ScheduledCollector = collectOnceWithDb
): (
  controller: WorkerScheduledController,
  env: WorkerEnv,
  ctx: WorkerExecutionContext
) => Promise<void> {
  return async (_controller, env, _ctx) => {
    try {
      await openDb(env, async (db) => {
        await runCollector(db);
      });
    } catch (error) {
      console.error("Scheduled collector cycle failed:", error);
    }
  };
}

export const scheduled = createScheduledHandler();

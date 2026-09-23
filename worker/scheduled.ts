import { collectOnceWithDb, type ScheduledCollectorDb } from "./collector";
import { withPgCollectorDatabase, type WorkerEnv } from "./db";

export type WorkerScheduledController = { cron?: string };
export type WorkerExecutionContext = { waitUntil(promise: Promise<unknown>): void };
export type ScheduledCollector = (db: ScheduledCollectorDb) => Promise<void>;
export type ScheduledRetention = (db: ScheduledCollectorDb) => Promise<unknown>;
export type ScheduledDbOpener = (
  env: WorkerEnv,
  callback: (db: ScheduledCollectorDb) => Promise<void>
) => Promise<void>;

export function createScheduledHandler(
  openDb: ScheduledDbOpener = withPgCollectorDatabase,
  runCollector: ScheduledCollector = collectOnceWithDb,
  runRetention: ScheduledRetention = (db) => db.retainSnapshots()
): (
  controller: WorkerScheduledController,
  env: WorkerEnv,
  ctx: WorkerExecutionContext
) => Promise<void> {
  return async (_controller, env, _ctx) => {
    try {
      await openDb(env, async (db) => {
        if (_controller.cron === "0 0 * * *") {
          await runRetention(db);
          console.log("Daily snapshot retention completed");
          return;
        }
        await runCollector(db);
      });
    } catch (error) {
      console.error("Scheduled collector cycle failed:", error);
    }
  };
}

export const scheduled = createScheduledHandler();

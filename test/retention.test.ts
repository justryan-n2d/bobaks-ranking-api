import test from "node:test";
import assert from "node:assert/strict";
import { retainSnapshots } from "../src/services/retention";

type Snapshot = {
  id: bigint;
  gameId: bigint;
  playerCount: number;
  timestamp: Date;
};

function makeDb(snapshots: Snapshot[]) {
  const dailyStats: Array<Record<string, unknown>> = [];
  const deletedIds: bigint[] = [];

  const db = {
    gameSnapshot: {
      findMany: async () => snapshots,
      deleteMany: async ({ where }: { where: { id: { in: bigint[] } } }) => {
        deletedIds.push(...where.id.in);
        return { count: where.id.in.length };
      }
    },
    dailyGameStat: {
      findUnique: async ({ where }: { where: { gameId_date: { gameId: bigint; date: Date } } }) => {
        return dailyStats.find(
          (row) => row.gameId === where.gameId_date.gameId && row.date instanceof Date && (row.date as Date).getTime() === where.gameId_date.date.getTime()
        ) as never ?? null;
      },
      upsert: async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const existing = dailyStats.find(
          (row) => row.gameId === create.gameId && row.date instanceof Date && (row.date as Date).getTime() === (create.date as Date).getTime()
        );

        if (existing) Object.assign(existing, update);
        else dailyStats.push({ ...create });
      }
    },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(db)
  };

  return { db, dailyStats, deletedIds };
}

test("keeps snapshots from the last 30 days", async () => {
  const now = new Date("2026-09-24T00:00:00.000Z");
  const snapshots: Snapshot[] = [
    { id: 1n, gameId: 1n, playerCount: 100, timestamp: new Date("2026-08-24T00:00:00.000Z") },
    { id: 2n, gameId: 1n, playerCount: 120, timestamp: new Date("2026-08-24T23:59:59.000Z") }
  ];
  const { db, deletedIds, dailyStats } = makeDb(snapshots);

  await retainSnapshots(db as never, now);

  assert.deepEqual(deletedIds, [2n]);
  assert.equal(dailyStats.length, 1);
});

test("aggregates old snapshots into daily statistics", async () => {
  const now = new Date("2026-09-24T00:00:00.000Z");
  const snapshots: Snapshot[] = [
    { id: 1n, gameId: 1n, playerCount: 100, timestamp: new Date("2026-08-20T01:00:00.000Z") },
    { id: 2n, gameId: 1n, playerCount: 200, timestamp: new Date("2026-08-20T02:00:00.000Z") },
    { id: 3n, gameId: 1n, playerCount: 50, timestamp: new Date("2026-08-20T03:00:00.000Z") }
  ];
  const { db, dailyStats } = makeDb(snapshots);

  await retainSnapshots(db as never, now);

  assert.deepEqual(dailyStats, [
    {
      gameId: 1n,
      date: new Date("2026-08-20T00:00:00.000Z"),
      averagePlayers: 350 / 3,
      peakPlayers: 200,
      lowestPlayers: 50,
      totalSamples: 3
    }
  ]);
});

test("retention is retry-safe and does not duplicate daily statistics", async () => {
  const now = new Date("2026-09-24T00:00:00.000Z");
  const snapshots: Snapshot[] = [
    { id: 1n, gameId: 1n, playerCount: 100, timestamp: new Date("2026-08-20T01:00:00.000Z") }
  ];
  const { db, dailyStats } = makeDb(snapshots);

  await retainSnapshots(db as never, now);
  await retainSnapshots(db as never, now);

  assert.equal(dailyStats.length, 1);
});

test("does not delete raw snapshots when daily aggregation fails", async () => {
  const now = new Date("2026-09-24T00:00:00.000Z");
  const snapshots: Snapshot[] = [
    { id: 1n, gameId: 1n, playerCount: 100, timestamp: new Date("2026-08-20T01:00:00.000Z") }
  ];
  const { db, deletedIds } = makeDb(snapshots);
  db.dailyGameStat.upsert = async () => {
    throw new Error("simulated aggregation failure");
  };

  await assert.rejects(retainSnapshots(db as never, now), /simulated aggregation failure/);
  assert.deepEqual(deletedIds, []);
});

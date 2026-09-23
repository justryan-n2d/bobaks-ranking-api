import test from "node:test";
import assert from "node:assert/strict";
import { recordPeak } from "../src/services/peak";

function makeDb() {
  const peaks = new Map<string, { gameId: bigint; peakPlayers: number; peakAt: Date }>();

  const db = {
    gamePeak: {
      findUnique: async ({ where }: { where: { gameId: bigint } }) =>
        peaks.get(where.gameId.toString()) ?? null,
      create: async ({ data }: { data: { gameId: bigint; peakPlayers: number; peakAt: Date } }) => {
        const peak = { ...data };
        peaks.set(data.gameId.toString(), peak);
        return peak;
      },
      update: async ({ where, data }: {
        where: { gameId: bigint };
        data: { peakPlayers: number; peakAt: Date };
      }) => {
        const current = peaks.get(where.gameId.toString());
        if (!current) throw new Error("Peak not found");
        const updated = { ...current, ...data };
        peaks.set(where.gameId.toString(), updated);
        return updated;
      }
    }
  };

  return {
    db,
    getPeak: (gameId: bigint) => peaks.get(gameId.toString()) ?? null
  };
}

test("first snapshot creates a persistent peak", async () => {
  const { db, getPeak } = makeDb();
  const at = new Date("2026-09-23T10:00:00.000Z");

  await recordPeak(db as never, 1n, 100, at);

  assert.deepEqual(getPeak(1n), {
    gameId: 1n,
    peakPlayers: 100,
    peakAt: at
  });
});

test("higher snapshot updates the peak", async () => {
  const { db, getPeak } = makeDb();
  const firstAt = new Date("2026-09-23T10:00:00.000Z");
  const secondAt = new Date("2026-09-23T10:05:00.000Z");

  await recordPeak(db as never, 1n, 100, firstAt);
  await recordPeak(db as never, 1n, 150, secondAt);

  assert.deepEqual(getPeak(1n), {
    gameId: 1n,
    peakPlayers: 150,
    peakAt: secondAt
  });
});

test("lower snapshot does not lower the existing peak", async () => {
  const { db, getPeak } = makeDb();
  const peakAt = new Date("2026-09-23T10:00:00.000Z");
  const lowerAt = new Date("2026-09-23T10:05:00.000Z");

  await recordPeak(db as never, 1n, 150, peakAt);
  await recordPeak(db as never, 1n, 100, lowerAt);

  assert.deepEqual(getPeak(1n), {
    gameId: 1n,
    peakPlayers: 150,
    peakAt
  });
});

test("equal snapshot does not create a bad update", async () => {
  const { db, getPeak } = makeDb();
  const peakAt = new Date("2026-09-23T10:00:00.000Z");
  const equalAt = new Date("2026-09-23T10:05:00.000Z");

  await recordPeak(db as never, 1n, 150, peakAt);
  await recordPeak(db as never, 1n, 150, equalAt);

  assert.deepEqual(getPeak(1n), {
    gameId: 1n,
    peakPlayers: 150,
    peakAt
  });
});

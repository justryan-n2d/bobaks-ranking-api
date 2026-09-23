import test from "node:test";
import assert from "node:assert/strict";
import { refreshRankings } from "../src/services/ranking";

type FakeState = {
  rankings: Array<Record<string, unknown>>;
};

function makeDb(options: {
  failOnQueryRaw?: number;
  snapshots?: Array<{ gameId: bigint; playerCount: number }>;
  averages?: Array<{ gameId: bigint; score: number }>;
}) {
  const committed: FakeState = {
    rankings: [{ gameId: 99n, period: "live", rank: 1, score: 999 }]
  };

  const games = [{ id: 1n }, { id: 2n }];
  let queryRawCalls = 0;

  const db = {
    game: {
      findMany: async () => games
    },
    $transaction: async (callback: (tx: unknown) => Promise<void>) => {
      const working: FakeState = {
        rankings: committed.rankings.map((row) => ({ ...row }))
      };

      const tx = {
        ranking: {
          deleteMany: async () => {
            working.rankings = [];
          },
          createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
            working.rankings.push(...data);
          }
        },
        $queryRaw: async () => {
          queryRawCalls += 1;
          if (options.failOnQueryRaw === queryRawCalls) {
            throw new Error("simulated ranking query failure");
          }

          return queryRawCalls === 1
            ? (options.snapshots ?? [])
            : (options.averages ?? []);
        }
      };

      try {
        await callback(tx);
      } catch (error) {
        throw error;
      }

      committed.rankings = working.rankings;
    }
  };

  return {
    db,
    getCommittedRankings: () => committed.rankings
  };
}

test("ranking refresh keeps the previous rankings when a transaction fails", async () => {
  const { db, getCommittedRankings } = makeDb({
    failOnQueryRaw: 2,
    snapshots: [
      { gameId: 1n, playerCount: 100 },
      { gameId: 2n, playerCount: 50 }
    ]
  });

  await assert.rejects(refreshRankings(db as never), /simulated ranking query failure/);

  assert.deepEqual(getCommittedRankings(), [
    { gameId: 99n, period: "live", rank: 1, score: 999 }
  ]);
});

test("ranking refresh commits the complete replacement only after all periods succeed", async () => {
  const { db, getCommittedRankings } = makeDb({
    snapshots: [
      { gameId: 1n, playerCount: 100 },
      { gameId: 2n, playerCount: 50 }
    ],
    averages: [
      { gameId: 1n, score: 90 },
      { gameId: 2n, score: 40 }
    ]
  });

  await refreshRankings(db as never);

  const rankings = getCommittedRankings();
  assert.equal(rankings.length, 8);
  assert.deepEqual(
    rankings.filter((row) => row.period === "live").map((row) => [row.gameId, row.rank, row.score]),
    [
      [1n, 1, 100],
      [2n, 2, 50]
    ]
  );
  assert.deepEqual(
    rankings.filter((row) => row.period === "weekly").map((row) => [row.gameId, row.rank, row.score]),
    [
      [1n, 1, 90],
      [2n, 2, 40]
    ]
  );
});

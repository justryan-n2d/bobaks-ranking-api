import test from "node:test";
import assert from "node:assert/strict";
import { backfillMissingPeaks } from "../src/services/peak-backfill";

test("historical peak backfill inserts only missing game peaks", async () => {
  let called = 0;

  const db = {
    $queryRaw: async () => {
      called++;
      return [{ gameId: 1n }, { gameId: 2n }, { gameId: 3n }];
    }
  };

  const count = await backfillMissingPeaks(db as never);

  assert.equal(called, 1);
  assert.equal(count, 3);
});

test("historical peak backfill reports zero when no peaks are missing", async () => {
  const db = {
    $queryRaw: async () => []
  };

  const count = await backfillMissingPeaks(db as never);

  assert.equal(count, 0);
});

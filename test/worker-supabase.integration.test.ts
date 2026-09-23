import test from "node:test";
import assert from "node:assert/strict";
import { withPgDatabase, type WorkerEnv } from "../worker/db";
import { createApiHandler } from "../worker/api";

const connectionString = process.env.BOBAKS_SUPABASE_DATABASE_URL;

test("live Supabase Worker adapter smoke test", { skip: !connectionString }, async () => {
  const env: WorkerEnv = {
    HYPERDRIVE: { connectionString: connectionString! }
  };

  await withPgDatabase(env, async (db) => {
    const health = await db.health();
    assert.equal(health, undefined);

    const handler = createApiHandler(db, { collectorIntervalMinutes: 5 });

    const healthResponse = await handler(new Request("http://localhost/api/health"));
    assert.equal(healthResponse.status, 200);
    assert.equal((await healthResponse.json()).database, "connected");

    const rankingsResponse = await handler(
      new Request("http://localhost/api/rankings?period=live")
    );
    assert.equal(rankingsResponse.status, 200);
    const rankings = await rankingsResponse.json();
    assert.equal(rankings.period, "live");
    assert.ok(Array.isArray(rankings.data));

    for (const period of ["week", "month", "year"]) {
      const response = await handler(
        new Request(`http://localhost/api/rankings?period=${period}`)
      );
      assert.equal(response.status, 200);
      assert.equal((await response.json()).period, period);
    }

    const gamesResponse = await handler(new Request("http://localhost/api/games"));
    assert.equal(gamesResponse.status, 200);
    assert.ok(Array.isArray((await gamesResponse.json()).data));

    const searchResponse = await handler(
      new Request("http://localhost/api/search?q=roblox")
    );
    assert.equal(searchResponse.status, 200);
    assert.ok(Array.isArray((await searchResponse.json()).data));
  });
});

test("live Supabase integration test is explicitly opt-in", () => {
  if (!connectionString) {
    assert.ok(true);
    return;
  }

  assert.notEqual(connectionString.trim(), "");
});

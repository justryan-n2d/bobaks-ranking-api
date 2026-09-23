import test from "node:test";
import assert from "node:assert/strict";
import { createScheduledHandler } from "../worker/scheduled";

function fakeDb() {
  return {} as never;
}

test("scheduled invocation runs the collector exactly once", async () => {
  let opened = 0;
  let collected = 0;

  const handler = createScheduledHandler(
    async (_env, callback) => {
      opened++;
      await callback(fakeDb());
    },
    async () => {
      collected++;
    }
  );

  await handler({}, { HYPERDRIVE: { connectionString: "test" } }, { waitUntil() {} });

  assert.equal(opened, 1);
  assert.equal(collected, 1);
});

test("collector rejection is caught by the scheduled handler", async () => {
  const errors: unknown[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => errors.push(args);

  try {
    const handler = createScheduledHandler(
      async (_env, callback) => callback(fakeDb()),
      async () => {
        throw new Error("simulated collector failure");
      }
    );

    await assert.doesNotReject(
      handler({}, { HYPERDRIVE: { connectionString: "test" } }, { waitUntil() {} })
    );
  } finally {
    console.error = original;
  }

  assert.equal(errors.length, 1);
  assert.match(String((errors[0] as unknown[])[0]), /Scheduled collector cycle failed/);
});

test("scheduled handler source does not use setInterval", async () => {
  const fs = await import("node:fs/promises");
  const source = await fs.readFile(new URL("../worker/scheduled.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /setInterval\s*\(/);
});

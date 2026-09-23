import test from "node:test";
import assert from "node:assert/strict";
import { getDatabaseUrl } from "../src/config/database";

test("database configuration reads DATABASE_URL", () => {
  const url = "postgresql://user:password@example.com:5432/bobaks";
  assert.equal(getDatabaseUrl({ DATABASE_URL: url }), url);
});

test("database configuration trims DATABASE_URL", () => {
  assert.equal(
    getDatabaseUrl({ DATABASE_URL: "  postgresql://example.com/bobaks  " }),
    "postgresql://example.com/bobaks"
  );
});

test("database configuration rejects a missing DATABASE_URL", () => {
  assert.throws(
    () => getDatabaseUrl({}),
    /DATABASE_URL is required/
  );
});

test("database configuration rejects an empty DATABASE_URL", () => {
  assert.throws(
    () => getDatabaseUrl({ DATABASE_URL: "   " }),
    /DATABASE_URL is required/
  );
});

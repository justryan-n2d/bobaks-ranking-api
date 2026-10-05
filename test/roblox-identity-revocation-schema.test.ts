import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const MIGRATION = join(
  process.cwd(),
  "supabase",
  "migrations",
  "20261005150000_roblox_identity_revoked_uniqueness.sql"
);

test("revoked Roblox identities do not participate in cross-account uniqueness", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  assert.match(
    sql,
    /CREATE UNIQUE INDEX roblox_identities_roblox_user_unique[\s\S]*ON public\.roblox_identities \(roblox_user_id\)[\s\S]*WHERE status = 'connected';/i
  );
  assert.match(
    sql,
    /CREATE UNIQUE INDEX roblox_identities_provider_subject_unique[\s\S]*ON public\.roblox_identities \(provider_subject\)[\s\S]*WHERE status = 'connected';/i
  );
  assert.match(sql, /DROP INDEX IF EXISTS public\.roblox_identities_roblox_user_unique;/i);
  assert.match(sql, /DROP INDEX IF EXISTS public\.roblox_identities_provider_subject_unique;/i);
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

test("legal consent migration records current policy versions and trusted acceptance", () => {
  const migration = readFileSync(
    resolve(process.cwd(), "supabase/migrations/20261006001900_legal_consent_versions.sql"),
    "utf8",
  );

  assert.match(migration, /terms_version text/);
  assert.match(migration, /terms_accepted_at timestamptz/);
  assert.match(migration, /privacy_version text/);
  assert.match(migration, /privacy_accepted_at timestamptz/);
  assert.match(migration, /accept_current_legal/);
  assert.match(migration, /'2026-10-06'/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.accept_current_legal\(\) TO authenticated/);
  assert.match(migration, /GRANT UPDATE \(display_name, avatar_url, is_public\) ON TABLE public\.profiles TO authenticated/);
});

-- Supabase security hardening.
-- Fix the audit function search path and make core ranking tables
-- explicitly inaccessible to direct anon/authenticated table access.

ALTER FUNCTION public.get_rankings_audit()
  SET search_path = public, pg_temp;

REVOKE ALL ON TABLE public."Game" FROM anon, authenticated;
DROP POLICY IF EXISTS deny_direct_api_access ON public."Game";
CREATE POLICY deny_direct_api_access
  ON public."Game"
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

REVOKE ALL ON TABLE public."GameSnapshot" FROM anon, authenticated;
DROP POLICY IF EXISTS deny_direct_api_access ON public."GameSnapshot";
CREATE POLICY deny_direct_api_access
  ON public."GameSnapshot"
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

REVOKE ALL ON TABLE public."GamePeak" FROM anon, authenticated;
DROP POLICY IF EXISTS deny_direct_api_access ON public."GamePeak";
CREATE POLICY deny_direct_api_access
  ON public."GamePeak"
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

REVOKE ALL ON TABLE public."DailyGameStat" FROM anon, authenticated;
DROP POLICY IF EXISTS deny_direct_api_access ON public."DailyGameStat";
CREATE POLICY deny_direct_api_access
  ON public."DailyGameStat"
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

REVOKE ALL ON TABLE public."DataCollectionLog" FROM anon, authenticated;
DROP POLICY IF EXISTS deny_direct_api_access ON public."DataCollectionLog";
CREATE POLICY deny_direct_api_access
  ON public."DataCollectionLog"
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

REVOKE ALL ON TABLE public."Ranking" FROM anon, authenticated;
DROP POLICY IF EXISTS deny_direct_api_access ON public."Ranking";
CREATE POLICY deny_direct_api_access
  ON public."Ranking"
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

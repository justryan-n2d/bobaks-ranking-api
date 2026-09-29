-- Harden the ranking audit RPC against mutable search_path resolution.
ALTER FUNCTION public.get_rankings_audit()
  SET search_path = public, pg_temp;

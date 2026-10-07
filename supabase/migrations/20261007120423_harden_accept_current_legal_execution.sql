-- Restrict legal-consent RPC execution to authenticated application flows and service-side workers.
REVOKE EXECUTE ON FUNCTION public.accept_current_legal() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_current_legal() TO authenticated, service_role;
ALTER FUNCTION public.accept_current_legal() SET search_path = '';

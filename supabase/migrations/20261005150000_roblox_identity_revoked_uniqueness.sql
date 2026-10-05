-- Phase 6.7 Roblox identity lifecycle hardening.
-- Keep revoked identity history without blocking a later connection of the same
-- Roblox account to another Bobaks account.
--
-- The user_id primary key still lets the same Bobaks account reconnect by
-- updating its existing identity row. Only active connections participate in
-- the cross-account uniqueness constraints.

DROP INDEX IF EXISTS public.roblox_identities_roblox_user_unique;
CREATE UNIQUE INDEX roblox_identities_roblox_user_unique
  ON public.roblox_identities (roblox_user_id)
  WHERE status = 'connected';

DROP INDEX IF EXISTS public.roblox_identities_provider_subject_unique;
CREATE UNIQUE INDEX roblox_identities_provider_subject_unique
  ON public.roblox_identities (provider_subject)
  WHERE status = 'connected';

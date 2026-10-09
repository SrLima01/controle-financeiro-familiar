-- Explicitly restrict the SECURITY DEFINER RPC to signed-in users.
-- Keep this corrective migration even though the initial migration also revokes anon,
-- so environments where the initial migration was already applied receive the hardening.
revoke all on function public.ensure_personal_space() from public, anon;
grant execute on function public.ensure_personal_space() to authenticated;

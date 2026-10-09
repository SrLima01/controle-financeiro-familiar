-- Explicitly restrict the SECURITY DEFINER RPC to signed-in users.
-- Keep this corrective migration so environments where the initial migration was
-- already applied receive the same hardening.
revoke all on function public.ensure_personal_space() from public, anon;
grant execute on function public.ensure_personal_space() to authenticated;

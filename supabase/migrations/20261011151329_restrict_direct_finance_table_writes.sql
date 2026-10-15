-- Mirrors Supabase migration 20261011151329_restrict_direct_finance_table_writes.
-- Direct client mutations are disabled for these tables. Authenticated users
-- retain SELECT access (subject to RLS); mutations must use the guarded RPCs.
revoke all privileges on table public.families, public.family_members, public.finance_state from anon;
revoke insert, update, delete, truncate, references, trigger on table public.families, public.family_members, public.finance_state from authenticated;
grant select on table public.families, public.family_members, public.finance_state to authenticated;

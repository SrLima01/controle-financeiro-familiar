-- Family creation and joining must go through the guarded SECURITY DEFINER RPCs.
-- Direct inserts let an authenticated user add themselves to any family ID
-- without presenting the invitation code.
drop policy if exists members_insert_self on public.family_members;

-- Prevent creating orphan family rows without the matching membership and initial state.
drop policy if exists families_insert_auth on public.families;

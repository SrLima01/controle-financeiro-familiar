-- Keep the family-membership helper private to the database.
-- RLS policies use a direct membership EXISTS check so authenticated users
-- do not need EXECUTE access to a SECURITY DEFINER helper in public.
drop policy if exists families_select_member on public.families;
create policy families_select_member
on public.families
for select
to authenticated
using (
  exists (
    select 1
    from public.family_members fm
    where fm.family_id = families.id
      and fm.user_id = (select auth.uid())
  )
);

drop policy if exists finance_select_member on public.finance_state;
create policy finance_select_member
on public.finance_state
for select
to authenticated
using (
  exists (
    select 1
    from public.family_members fm
    where fm.family_id = finance_state.family_id
      and fm.user_id = (select auth.uid())
  )
);

drop policy if exists finance_update_member on public.finance_state;
create policy finance_update_member
on public.finance_state
for update
to authenticated
using (
  exists (
    select 1
    from public.family_members fm
    where fm.family_id = finance_state.family_id
      and fm.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.family_members fm
    where fm.family_id = finance_state.family_id
      and fm.user_id = (select auth.uid())
  )
  and updated_by = (select auth.uid())
);

drop policy if exists finance_insert_member on public.finance_state;
create policy finance_insert_member
on public.finance_state
for insert
to authenticated
with check (
  exists (
    select 1
    from public.family_members fm
    where fm.family_id = finance_state.family_id
      and fm.user_id = (select auth.uid())
  )
  and updated_by = (select auth.uid())
);

revoke execute on function public.is_family_member(uuid) from public, anon, authenticated;

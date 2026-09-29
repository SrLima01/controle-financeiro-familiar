-- Harden family RLS and RPC permissions.
create or replace function public.is_family_member(p_family_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.family_members fm
    where fm.family_id = p_family_id
      and fm.user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_family_member(uuid) from public;
revoke all on function public.is_family_member(uuid) from anon;
revoke all on function public.is_family_member(uuid) from authenticated;

drop policy if exists members_select_member on public.family_members;
create policy members_select_member
on public.family_members
for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists families_select_member on public.families;
create policy families_select_member
on public.families
for select
to authenticated
using ((select public.is_family_member(id)));

drop policy if exists finance_select_member on public.finance_state;
create policy finance_select_member
on public.finance_state
for select
to authenticated
using ((select public.is_family_member(family_id)));

drop policy if exists finance_update_member on public.finance_state;
create policy finance_update_member
on public.finance_state
for update
to authenticated
using ((select public.is_family_member(family_id)))
with check (
  (select public.is_family_member(family_id))
  and updated_by = (select auth.uid())
);

drop policy if exists finance_insert_member on public.finance_state;
create policy finance_insert_member
on public.finance_state
for insert
to authenticated
with check (
  (select public.is_family_member(family_id))
  and updated_by = (select auth.uid())
);

revoke execute on function public.create_family(text) from anon;
revoke execute on function public.join_family(text) from anon;
revoke execute on function public.save_finance_state(uuid, jsonb, bigint) from anon;

grant execute on function public.create_family(text) to authenticated;
grant execute on function public.join_family(text) to authenticated;
grant execute on function public.save_finance_state(uuid, jsonb, bigint) to authenticated;

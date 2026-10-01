-- Optimize RLS auth lookups and foreign-key maintenance.
drop policy if exists families_insert_auth on public.families;
create policy families_insert_auth
on public.families
for insert
to authenticated
with check (created_by = (select auth.uid()));

drop policy if exists members_insert_self on public.family_members;
create policy members_insert_self
on public.family_members
for insert
to authenticated
with check (user_id = (select auth.uid()));

create index if not exists idx_families_created_by on public.families(created_by);
create index if not exists idx_finance_state_updated_by on public.finance_state(updated_by);

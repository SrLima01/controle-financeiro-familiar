-- Ensure every newly registered user can start with a private financial workspace.
-- Reuses the existing family/workspace model so finance_state, RLS and sync remain compatible.
create or replace function public.ensure_personal_space()
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $function$
declare
  v_user uuid;
  v_workspace uuid;
begin
  v_user := auth.uid();
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  -- Prevent duplicate personal workspaces if two devices initialize together.
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 0));

  select fm.family_id
    into v_workspace
    from public.family_members fm
   where fm.user_id = v_user
   order by fm.created_at asc
   limit 1;

  if v_workspace is not null then
    return v_workspace;
  end if;

  return public.create_family('Minhas finanças');
end;
$function$;

revoke all on function public.ensure_personal_space() from public;
grant execute on function public.ensure_personal_space() to authenticated;

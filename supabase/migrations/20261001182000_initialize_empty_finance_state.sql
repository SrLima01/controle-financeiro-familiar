-- Ensure newly created families start with a valid FinanceState shape.
-- Also repairs any legacy empty JSON state before strict client-side validation.

create or replace function public.create_family(p_name text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_family uuid;
  v_code text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if coalesce(trim(p_name),'') = '' then raise exception 'family_name_required'; end if;

  v_code := upper(substr(encode(gen_random_bytes(6),'hex'),1,10));

  insert into public.families(name, invite_code, created_by)
  values(trim(p_name), v_code, auth.uid())
  returning id into v_family;

  insert into public.family_members(family_id,user_id,role)
  values(v_family,auth.uid(),'owner');

  insert into public.finance_state(family_id,schema_version,state,version,updated_by)
  values(
    v_family,
    1,
    jsonb_build_object(
      'people', '[]'::jsonb,
      'categories', '[]'::jsonb,
      'accounts', '[]'::jsonb,
      'cards', '[]'::jsonb,
      'transactions', '[]'::jsonb,
      'installmentGroups', '[]'::jsonb,
      'recurringRules', '[]'::jsonb,
      'pots', '[]'::jsonb,
      'potMovements', '[]'::jsonb,
      'budgets', '[]'::jsonb
    ),
    0,
    auth.uid()
  );

  return v_family;
end;
$function$;

update public.finance_state
set state = jsonb_build_object(
  'people', '[]'::jsonb,
  'categories', '[]'::jsonb,
  'accounts', '[]'::jsonb,
  'cards', '[]'::jsonb,
  'transactions', '[]'::jsonb,
  'installmentGroups', '[]'::jsonb,
  'recurringRules', '[]'::jsonb,
  'pots', '[]'::jsonb,
  'potMovements', '[]'::jsonb,
  'budgets', '[]'::jsonb
)
where state = '{}'::jsonb;

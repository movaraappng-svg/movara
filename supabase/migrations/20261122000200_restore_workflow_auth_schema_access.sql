-- SECURITY DEFINER RPCs run as this restricted non-login role. The auth schema
-- is owned by Supabase's reserved role, so workflow RPCs must use the existing
-- postgres-owned private.current_user_id() wrapper instead of calling auth.uid()
-- directly. Use temporary CREATE privilege on public only while replacing those
-- functions, then remove it again.
set role pg_database_owner;
grant create on schema public to movara_workflow_owner;
reset role;
set role movara_workflow_owner;
do $$
declare
  v_function record;
  v_definition text;
begin
  for v_function in
    select p.oid
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proowner = (select oid from pg_catalog.pg_roles where rolname = current_user)
      and p.prosecdef
      and pg_catalog.pg_get_functiondef(p.oid) like '%auth.uid()%'
  loop
    v_definition := pg_catalog.pg_get_functiondef(v_function.oid);
    v_definition := replace(v_definition, 'auth.uid()', 'private.current_user_id()');
    execute v_definition;
  end loop;
end;
$$;
reset role;
set role pg_database_owner;
revoke create on schema public from movara_workflow_owner;
reset role;

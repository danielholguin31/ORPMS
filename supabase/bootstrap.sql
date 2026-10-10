-- SEBASTIAN-01: Run ONCE as migration owner after replacing every placeholder.
-- Provision and verify the first admin in Supabase Auth before running this.
-- The app does not bootstrap accounts or seed production tasks automatically.
begin;
do $$
declare
  workspace_uuid uuid := '__SEBASTIAN_WORKSPACE_UUID__';
  admin_auth_uuid uuid := '__SEBASTIAN_VERIFIED_AUTH_USER_UUID__';
  workspace_zone text := '__SEBASTIAN_IANA_TIME_ZONE__';
  admin_name text := '__SEBASTIAN_ADMIN_DISPLAY_NAME__';
  admin_email text;
begin
  select lower(email) into admin_email from auth.users where id=admin_auth_uuid and email_confirmed_at is not null;
  if admin_email is null then raise exception 'The first admin must have a verified managed-auth account'; end if;
  if exists(select 1 from openrange.workspaces) then raise exception 'A workspace already exists; bootstrap is a one-time operation'; end if;
  perform pg_advisory_xact_lock(hashtextextended(workspace_uuid::text,0));
  insert into openrange.workspaces(id,name,time_zone) values(workspace_uuid,'Openrange',workspace_zone);
  insert into openrange.profiles(user_id,display_name,email) values(admin_auth_uuid,admin_name,admin_email);
  insert into openrange.members(id,workspace_id,user_id,role,active,version,created_at,updated_at)
    values(gen_random_uuid(),workspace_uuid,admin_auth_uuid,'admin',true,1,now(),now());
end $$;
commit;

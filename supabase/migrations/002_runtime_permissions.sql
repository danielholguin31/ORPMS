-- A NOLOGIN group role separates runtime grants from the migration owner.
-- Sebastián creates a server-only LOGIN role and grants it this role at setup.
do $$ begin
  if not exists(select 1 from pg_roles where rolname='openrange_app') then create role openrange_app nologin; end if;
end $$;
grant usage on schema openrange to openrange_app;
grant select,update on openrange.workspaces to openrange_app;
grant select,insert,update on openrange.profiles,openrange.members,openrange.projects,openrange.tasks,openrange.comments,openrange.invites,openrange.notifications to openrange_app;
grant select,insert,update,delete on openrange.milestones to openrange_app;
grant select,insert,delete on openrange.task_collaborators,openrange.mutation_receipts to openrange_app;
grant select,insert on openrange.activities to openrange_app;

do $$ declare tab text; begin
  foreach tab in array array['workspaces','profiles','members','projects','milestones','tasks','task_collaborators','comments','activities','notifications','invites','mutation_receipts'] loop
    execute format('create policy server_application_only on openrange.%I for all to openrange_app using (true) with check (true)',tab);
  end loop;
  -- Explicitly remove Supabase browser-role access if those roles are present.
  foreach tab in array array['anon','authenticated'] loop
    if exists(select 1 from pg_roles where rolname=tab) then
      execute format('revoke all on schema openrange from %I',tab);
      execute format('revoke all on all tables in schema openrange from %I',tab);
      execute format('revoke all on all functions in schema openrange from %I',tab);
    end if;
  end loop;
end $$;

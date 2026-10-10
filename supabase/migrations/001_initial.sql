-- Private application schema. Browsers use authenticated application endpoints.
-- Run with the migration owner, not the runtime application's database role.
create schema if not exists openrange;
revoke all on schema openrange from public;

create table openrange.workspaces (
  id uuid primary key default gen_random_uuid(), name text not null check (length(name) between 1 and 160),
  time_zone text not null, version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table openrange.profiles (
  user_id uuid primary key references auth.users(id), display_name text not null check (length(display_name) between 1 and 160),
  email text not null check (email = lower(email))
);
create table openrange.members (
  id uuid primary key, workspace_id uuid not null references openrange.workspaces(id), user_id uuid not null references openrange.profiles(user_id),
  role text not null check (role in ('admin','member')), active boolean not null default true,
  version integer not null default 1 check (version > 0), created_at timestamptz not null, updated_at timestamptz not null,
  unique (workspace_id,user_id), unique (workspace_id,id)
);
create table openrange.projects (
  id uuid primary key, workspace_id uuid not null references openrange.workspaces(id), name text not null check (length(btrim(name)) between 1 and 160),
  description text not null default '' check (length(description) <= 20000), owner_id uuid,
  status text not null check (status in ('planned','active','done','canceled')), start_date date, target_date date, archived_at timestamptz,
  version integer not null default 1 check (version > 0), created_at timestamptz not null, updated_at timestamptz not null,
  check (start_date is null or target_date is null or start_date <= target_date), unique (workspace_id,id),
  foreign key (workspace_id,owner_id) references openrange.members(workspace_id,id)
);
create table openrange.milestones (
  id uuid primary key, workspace_id uuid not null references openrange.workspaces(id), project_id uuid not null,
  name text not null check (length(btrim(name)) between 1 and 160), description text not null default '' check (length(description) <= 20000),
  target_date date, sort_order integer not null check (sort_order >= 0), version integer not null check (version > 0), created_at timestamptz not null, updated_at timestamptz not null,
  unique (workspace_id,id), unique (workspace_id,project_id,id),
  foreign key (workspace_id,project_id) references openrange.projects(workspace_id,id)
);
create table openrange.tasks (
  id uuid primary key, workspace_id uuid not null references openrange.workspaces(id), project_id uuid not null,
  parent_id uuid, milestone_id uuid, title text not null check (length(btrim(title)) between 1 and 160),
  description text not null default '' check (length(description) <= 20000), status text not null check (status in ('todo','in_progress','done','canceled')),
  assignee_id uuid, start_date date, due_date date, blocked_by_id uuid, deleted_at timestamptz, deletion_batch_id uuid,
  version integer not null check (version > 0), created_at timestamptz not null, updated_at timestamptz not null,
  unique (workspace_id,id), unique (workspace_id,project_id,id),
  check (start_date is null or due_date is null or start_date <= due_date),
  check (parent_id is null or milestone_id is null), check (parent_id is distinct from id), check (blocked_by_id is distinct from id),
  check ((deleted_at is null) = (deletion_batch_id is null)),
  foreign key (workspace_id,project_id) references openrange.projects(workspace_id,id),
  foreign key (workspace_id,project_id,parent_id) references openrange.tasks(workspace_id,project_id,id) deferrable initially deferred,
  foreign key (workspace_id,project_id,blocked_by_id) references openrange.tasks(workspace_id,project_id,id) deferrable initially deferred,
  foreign key (workspace_id,project_id,milestone_id) references openrange.milestones(workspace_id,project_id,id) deferrable initially deferred,
  foreign key (workspace_id,assignee_id) references openrange.members(workspace_id,id)
);
create table openrange.task_collaborators (
  workspace_id uuid not null, task_id uuid not null, member_id uuid not null,
  primary key (workspace_id,task_id,member_id),
  foreign key (workspace_id,task_id) references openrange.tasks(workspace_id,id),
  foreign key (workspace_id,member_id) references openrange.members(workspace_id,id)
);
create table openrange.comments (
  id uuid primary key, workspace_id uuid not null, task_id uuid not null, author_id uuid not null,
  body text not null check (length(body) <= 20000), mention_ids uuid[] not null default '{}', edited_at timestamptz, deleted_at timestamptz,
  version integer not null check (version > 0), created_at timestamptz not null, updated_at timestamptz not null,
  foreign key (workspace_id,task_id) references openrange.tasks(workspace_id,id),
  foreign key (workspace_id,author_id) references openrange.members(workspace_id,id)
);
create table openrange.activities (
  id uuid primary key, workspace_id uuid not null references openrange.workspaces(id), entity_type text not null,
  entity_id uuid not null, actor_id uuid not null, event_type text not null, changed_fields jsonb not null default '{}', occurred_at timestamptz not null,
  unique (workspace_id,id), foreign key (workspace_id,actor_id) references openrange.members(workspace_id,id)
);
create table openrange.notifications (
  id uuid primary key, workspace_id uuid not null, recipient_id uuid not null, activity_id uuid not null, task_id uuid,
  kind text not null check (kind in ('assignment','comment','mention','change','needs_owner')), read_at timestamptz,
  unique (activity_id,recipient_id),
  foreign key (workspace_id,recipient_id) references openrange.members(workspace_id,id),
  foreign key (workspace_id,activity_id) references openrange.activities(workspace_id,id),
  foreign key (workspace_id,task_id) references openrange.tasks(workspace_id,id)
);
create table openrange.invites (
  id uuid primary key, workspace_id uuid not null references openrange.workspaces(id), email text not null check (email = lower(email)),
  role text not null check (role in ('admin','member')), token_hash text not null check (length(token_hash) = 64),
  expires_at timestamptz not null, accepted_at timestamptz, revoked_at timestamptz, invited_by uuid not null,
  version integer not null check (version > 0), created_at timestamptz not null, updated_at timestamptz not null,
  foreign key (workspace_id,invited_by) references openrange.members(workspace_id,id)
);
create table openrange.mutation_receipts (
  id uuid primary key, workspace_id uuid not null references openrange.workspaces(id), actor_user_id uuid not null references auth.users(id),
  idempotency_key text not null check (length(idempotency_key) between 8 and 128), request_hash text not null,
  response_json jsonb not null, status_code integer not null, expires_at timestamptz not null,
  unique (actor_user_id,idempotency_key)
);

create index tasks_project_idx on openrange.tasks(workspace_id,project_id,deleted_at);
create index tasks_parent_idx on openrange.tasks(workspace_id,parent_id);
create index tasks_assignee_idx on openrange.tasks(workspace_id,assignee_id,status);
create index tasks_milestone_idx on openrange.tasks(workspace_id,milestone_id);
create index tasks_blocker_idx on openrange.tasks(workspace_id,blocked_by_id);
create index notifications_recipient_idx on openrange.notifications(workspace_id,recipient_id,read_at);
create index comments_task_idx on openrange.comments(workspace_id,task_id,created_at);
create index activity_entity_idx on openrange.activities(workspace_id,entity_id,occurred_at);
create index receipt_expiry_idx on openrange.mutation_receipts(expires_at);

-- Every direct database writer also obtains the same workspace lock as the API.
create function openrange.lock_workspace() returns trigger language plpgsql as $$
declare wid uuid;
begin
  if tg_table_name = 'workspaces' then wid := coalesce(new.id,old.id);
  else wid := coalesce(new.workspace_id,old.workspace_id); end if;
  perform pg_advisory_xact_lock(hashtextextended(wid::text,0));
  if tg_op = 'DELETE' then return old; else return new; end if;
end $$;

-- Deferred checks inspect the final transaction state, including membership cleanup.
create function openrange.assert_invariants() returns trigger language plpgsql as $$
declare wid uuid;
begin
  wid := coalesce(new.workspace_id,old.workspace_id);
  if not exists (select 1 from openrange.members where workspace_id=wid and active and role='admin') then
    raise exception 'A workspace must retain an active admin' using errcode='23514';
  end if;
  if exists (select 1 from openrange.tasks c join openrange.tasks p on p.id=c.parent_id
    where c.workspace_id=wid and (p.parent_id is not null or (c.deleted_at is null and p.deleted_at is not null)
      or (c.deleted_at is null and c.status in ('todo','in_progress') and p.status in ('done','canceled')))) then
    raise exception 'Invalid subtask depth or parent state' using errcode='23514';
  end if;
  if exists (select 1 from openrange.projects p join openrange.tasks t on t.project_id=p.id
    where p.workspace_id=wid and p.status in ('done','canceled') and t.deleted_at is null and t.status in ('todo','in_progress')) then
    raise exception 'A closed project cannot contain open tasks' using errcode='23514';
  end if;
  if exists (select 1 from openrange.tasks t join openrange.tasks b on b.id=t.blocked_by_id
    where t.workspace_id=wid and (b.deleted_at is not null or b.parent_id=t.id or t.parent_id=b.id)) then
    raise exception 'Invalid blocker' using errcode='23514';
  end if;
  if exists (with recursive chain as (
    select id as root,id,blocked_by_id,array[id] as path,false as cycle from openrange.tasks where workspace_id=wid and blocked_by_id is not null
    union all select c.root,t.id,t.blocked_by_id,c.path || t.id,t.id=any(c.path)
    from chain c join openrange.tasks t on t.id=c.blocked_by_id where not c.cycle
  ) select 1 from chain where cycle) then
    raise exception 'Blocker cycle' using errcode='23514';
  end if;
  if exists (select 1 from openrange.tasks t join openrange.members m on m.id=t.assignee_id
    where t.workspace_id=wid and t.status in ('todo','in_progress') and not m.active) then
    raise exception 'Open tasks require an active assignee or no assignee' using errcode='23514';
  end if;
  if exists (select 1 from openrange.projects p join openrange.members m on m.id=p.owner_id
    where p.workspace_id=wid and p.status in ('planned','active') and not m.active) then
    raise exception 'Open projects require an active owner or no owner' using errcode='23514';
  end if;
  if exists (select 1 from openrange.task_collaborators c join openrange.members m on m.id=c.member_id where c.workspace_id=wid and not m.active) then
    raise exception 'Collaborators must be active members' using errcode='23514';
  end if;
  return null;
end $$;

create function openrange.guard_activity() returns trigger language plpgsql as $$
begin raise exception 'Activity is append-only' using errcode='23514'; end $$;
create trigger activity_append_only before update or delete on openrange.activities for each row execute function openrange.guard_activity();

create function openrange.guard_fixed_task_fields() returns trigger language plpgsql as $$
begin
  if new.project_id is distinct from old.project_id or new.parent_id is distinct from old.parent_id then
    raise exception 'Task project and parent are fixed' using errcode='23514';
  end if;
  return new;
end $$;
create trigger task_fixed_structure before update on openrange.tasks for each row execute function openrange.guard_fixed_task_fields();

create function openrange.guard_project_content() returns trigger language plpgsql as $$
declare pr openrange.projects; operation text; new_data jsonb; old_data jsonb; existing boolean;
begin
  operation := coalesce(current_setting('openrange.operation',true),'');
  new_data := to_jsonb(new); old_data := to_jsonb(old);
  -- An upsert runs INSERT triggers before its UPDATE branch. Defer existing-row
  -- checks to that UPDATE trigger, where OLD is available for cleanup validation.
  if tg_op='INSERT' and tg_table_name in ('tasks','milestones','comments') then
    execute format('select exists(select 1 from openrange.%I where id=$1)',tg_table_name) into existing using (new_data->>'id')::uuid;
    if existing then return new; end if;
  end if;
  if tg_table_name = 'projects' then
    if tg_op = 'UPDATE' and (old.archived_at is not null or old.status in ('done','canceled')) then
      if operation = 'member.patch' and (to_jsonb(new)-array['owner_id','version','updated_at'])=(to_jsonb(old)-array['owner_id','version','updated_at']) and new.owner_id is null then return new; end if;
      if (to_jsonb(new)-array['status','archived_at','owner_id','version','updated_at']) is distinct from (to_jsonb(old)-array['status','archived_at','owner_id','version','updated_at']) then
        raise exception 'Reopen or restore the project before editing content' using errcode='23514';
      end if;
      if old.archived_at is not null and operation not in ('project.archive','project.restore') then raise exception 'Project is archived' using errcode='23514'; end if;
      if old.status in ('done','canceled') and new.status not in ('planned','active') and operation not in ('project.archive','project.restore') then raise exception 'Reopen the project before editing content' using errcode='23514'; end if;
    end if;
    return new;
  end if;
  if tg_table_name = 'comments' then select p.* into pr from openrange.projects p join openrange.tasks t on t.project_id=p.id where t.id=new.task_id;
  elsif tg_table_name = 'task_collaborators' then select p.* into pr from openrange.projects p join openrange.tasks t on t.project_id=p.id where t.id=coalesce(new.task_id,old.task_id);
  else select * into pr from openrange.projects where id=coalesce(new.project_id,old.project_id); end if;
  if pr.archived_at is not null or pr.status in ('done','canceled') then
    if operation='member.patch' and tg_table_name='tasks' and tg_op='UPDATE' and ((new_data->>'assignee_id') is null or (new_data->>'assignee_id')=(old_data->>'assignee_id')) and (new_data-array['assignee_id','version','updated_at'])=(old_data-array['assignee_id','version','updated_at']) then return new; end if;
    if operation='member.patch' and tg_table_name='task_collaborators' and tg_op='DELETE' then return old; end if;
    raise exception 'Project is closed or archived' using errcode='23514';
  end if;
  if tg_table_name='tasks' and tg_op='INSERT' then
    if new.parent_id is not null and exists(select 1 from openrange.tasks where id=new.parent_id and (deleted_at is not null or status in ('done','canceled'))) then raise exception 'Reopen the parent before adding a subtask' using errcode='23514'; end if;
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end $$;
-- Names sort after workspace_lock, so direct writers lock before checking state.
create trigger zz_project_content before update on openrange.projects for each row execute function openrange.guard_project_content();
create trigger zz_task_content before insert or update on openrange.tasks for each row execute function openrange.guard_project_content();
create trigger zz_milestone_content before insert or update or delete on openrange.milestones for each row execute function openrange.guard_project_content();
create trigger zz_comment_content before insert or update on openrange.comments for each row execute function openrange.guard_project_content();
create trigger zz_collaborator_content before insert or delete on openrange.task_collaborators for each row execute function openrange.guard_project_content();

create function openrange.validate_mentions() returns trigger language plpgsql as $$
begin
  if tg_op='INSERT' or new.mention_ids is distinct from old.mention_ids then
    if exists(select 1 from unnest(new.mention_ids) mid where not exists(select 1 from openrange.members m where m.id=mid and m.workspace_id=new.workspace_id and m.active)) then raise exception 'Mentions must reference active workspace members' using errcode='23514'; end if;
  end if;
  return new;
end $$;
create trigger valid_comment_mentions before insert or update on openrange.comments for each row execute function openrange.validate_mentions();

create function openrange.guard_record_version() returns trigger language plpgsql as $$
begin
  if new.version <> old.version+1 then raise exception 'Editable records must advance exactly one version' using errcode='23514'; end if;
  if new.id is distinct from old.id or new.created_at is distinct from old.created_at or (to_jsonb(new)->'workspace_id') is distinct from (to_jsonb(old)->'workspace_id') then raise exception 'Record identity is fixed' using errcode='23514'; end if;
  return new;
end $$;
do $$ declare tab text; begin
  foreach tab in array array['workspaces','members','projects','milestones','tasks','comments','invites'] loop
    execute format('create trigger valid_record_version before update on openrange.%I for each row execute function openrange.guard_record_version()',tab);
  end loop;
end $$;

create function openrange.validate_time_zone() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from pg_timezone_names where name=new.time_zone) then raise exception 'Invalid IANA time zone' using errcode='23514'; end if;
  return new;
end $$;
create trigger workspace_time_zone before insert or update on openrange.workspaces for each row execute function openrange.validate_time_zone();

do $$ declare tab text; begin
  foreach tab in array array['members','projects','milestones','tasks','task_collaborators','comments','activities','notifications','invites','mutation_receipts'] loop
    execute format('create trigger workspace_lock before insert or update or delete on openrange.%I for each row execute function openrange.lock_workspace()',tab);
    execute format('alter table openrange.%I enable row level security',tab);
  end loop;
  foreach tab in array array['members','projects','milestones','tasks','task_collaborators'] loop
    execute format('create constraint trigger workspace_invariants after insert or update or delete on openrange.%I deferrable initially deferred for each row execute function openrange.assert_invariants()',tab);
  end loop;
end $$;
alter table openrange.workspaces enable row level security;
alter table openrange.profiles enable row level security;
revoke all on all tables in schema openrange from public;
revoke all on all functions in schema openrange from public;
-- No anon/authenticated policies: server-only access. Restrict the connection role
-- using the grants in docs/SEBASTIAN_HANDOFF.md; never expose this schema via REST.

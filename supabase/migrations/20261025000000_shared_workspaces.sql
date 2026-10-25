-- Shared workspaces (SPEC section 16).
-- State = base_data + events replayed in seq order through the deterministic engine. Decisions are never stored.
-- Access is only from server routes using the service role. RLS is on with NO policies, so the public API keys read nothing.

create table public.workspaces (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  name            text not null check (char_length(name) between 1 and 200),
  brand_profile   text not null default 'eyewear' check (brand_profile in ('eyewear', 'delivery', 'partner_point')),
  base_data       jsonb not null,
  source_filename text,
  row_counts      jsonb not null default '{}'::jsonb,
  -- A re-upload links back to the workspace it came from. It never replaces it.
  parent_id       uuid references public.workspaces (id) on delete set null,
  -- The next event number to hand out. Incremented under a row lock, so concurrent appends never collide.
  next_seq        integer not null default 1
);

create index workspaces_created_at_idx on public.workspaces (created_at desc);

create table public.events (
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  seq             integer not null,
  created_at      timestamptz not null default now(),
  type            text not null check (type in ('fact', 'territory_fact', 'withdraw', 'override', 'lock', 'policy_change', 'brand_switch', 'today_change', 'undo')),
  payload         jsonb not null,
  client_id       text,
  -- With client_id, makes a retried request harmless: the same client event is stored once.
  client_event_id text,
  primary key (workspace_id, seq)
);

create unique index events_client_event_uidx
  on public.events (workspace_id, client_id, client_event_id)
  where client_id is not null and client_event_id is not null;

alter table public.workspaces enable row level security;
alter table public.events enable row level security;
-- No policies on purpose.

-- Append one event atomically. Returns the event's seq, and whether it was already stored (a retry).
create or replace function public.append_event(
  p_workspace       uuid,
  p_type            text,
  p_payload         jsonb,
  p_client_id       text,
  p_client_event_id text
)
returns table (seq integer, created_at timestamptz, duplicate boolean)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_seq integer;
  v_existing record;
begin
  if p_client_id is not null and p_client_event_id is not null then
    select e.seq, e.created_at into v_existing
      from public.events e
     where e.workspace_id = p_workspace and e.client_id = p_client_id and e.client_event_id = p_client_event_id;
    if found then
      return query select v_existing.seq, v_existing.created_at, true;
      return;
    end if;
  end if;

  -- The row lock serialises concurrent appends to one workspace.
  update public.workspaces w set next_seq = w.next_seq + 1
   where w.id = p_workspace
   returning w.next_seq - 1 into v_seq;
  if v_seq is null then
    raise exception 'workspace not found' using errcode = 'P0002';
  end if;

  return query
    insert into public.events as e (workspace_id, seq, type, payload, client_id, client_event_id)
    values (p_workspace, v_seq, p_type, p_payload, p_client_id, p_client_event_id)
    returning e.seq, e.created_at, false;
end;
$$;

revoke all on function public.append_event(uuid, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.append_event(uuid, text, jsonb, text, text) to service_role;

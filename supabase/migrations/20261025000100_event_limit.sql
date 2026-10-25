-- Cap events per workspace (SPEC §16.4, G10.5). The cap is enforced where seq is assigned.
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

  update public.workspaces w set next_seq = w.next_seq + 1
   where w.id = p_workspace
   returning w.next_seq - 1 into v_seq;
  if v_seq is null then
    raise exception 'workspace not found' using errcode = 'P0002';
  end if;
  if v_seq > 5000 then
    raise exception 'event limit reached' using errcode = 'P0001';
  end if;

  return query
    insert into public.events as e (workspace_id, seq, type, payload, client_id, client_event_id)
    values (p_workspace, v_seq, p_type, p_payload, p_client_id, p_client_event_id)
    returning e.seq, e.created_at, false;
end;
$$;

revoke all on function public.append_event(uuid, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.append_event(uuid, text, jsonb, text, text) to service_role;

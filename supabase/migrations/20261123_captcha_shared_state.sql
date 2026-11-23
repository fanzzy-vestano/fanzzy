-- Isolated temporary state for customer OTP CAPTCHA; no existing table is changed.
begin;

create table public.fanzzy_otp_captcha_state_v1 (
  phone_key text primary key,
  sent_at bigint[] not null default '{}',
  challenges jsonb not null default '{}'::jsonb,
  reservation text,
  reservation_expires bigint,
  reservation_resets boolean not null default false,
  last_committed_reservation text,
  updated_at timestamptz not null default now()
);
create index fanzzy_otp_captcha_state_v1_updated_at on public.fanzzy_otp_captcha_state_v1(updated_at);
alter table public.fanzzy_otp_captcha_state_v1 enable row level security;
create policy fanzzy_otp_captcha_service_only on public.fanzzy_otp_captcha_state_v1
  for all to service_role using (true) with check (true);
revoke all on public.fanzzy_otp_captcha_state_v1 from public, anon, authenticated;
grant select, insert, update, delete on public.fanzzy_otp_captcha_state_v1 to service_role;

create function public.fanzzy_otp_captcha_op_v1(
  p_action text, p_phone text, p_client text default '', p_token text default '',
  p_answer text default '', p_new_token text default '', p_new_answer text default '',
  p_reservation text default ''
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  s public.fanzzy_otp_captcha_state_v1%rowtype;
  ms bigint;
  required_until bigint := 0;
  send_count integer;
  current_challenge jsonb;
  challenge_count integer;
begin
  if p_action not in ('reserve', 'verify', 'refresh', 'commit', 'abort') or length(p_phone) < 20 then
    raise exception 'Invalid CAPTCHA operation';
  end if;
  -- Opportunistic cleanup only touches stale records in this new table.
  if random() < 0.01 then
    delete from public.fanzzy_otp_captcha_state_v1 where updated_at < now() - interval '10 minutes';
  end if;
  insert into public.fanzzy_otp_captcha_state_v1(phone_key) values(p_phone) on conflict do nothing;
  select * into s from public.fanzzy_otp_captcha_state_v1 where phone_key = p_phone for update;
  ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  select coalesce(array_agg(t order by ord), '{}'::bigint[]) into s.sent_at
    from unnest(s.sent_at) with ordinality as entries(t, ord) where t > ms - 300000;
  send_count := coalesce(array_length(s.sent_at, 1), 0);
  if send_count >= 4 then required_until := s.sent_at[send_count - 3] + 300000; end if;
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) into s.challenges
    from jsonb_each(s.challenges) as c(k, v) where (v->>'expires')::bigint > ms;
  current_challenge := s.challenges -> p_token;
  s.updated_at := now();

  if p_action = 'commit' then
    if p_reservation <> '' and s.last_committed_reservation = p_reservation then
      return jsonb_build_object('status', 'committed');
    end if;
    if p_reservation = '' or s.reservation is distinct from p_reservation then
      raise exception 'CAPTCHA reservation expired';
    end if;
    s.sent_at := case when s.reservation_resets then array[ms]::bigint[] else array_append(s.sent_at, ms) end;
    if s.reservation_resets then
      s.challenges := '{}'::jsonb;
    end if;
    s.last_committed_reservation := p_reservation;
    s.reservation := null; s.reservation_expires := null; s.reservation_resets := false;
  elsif p_action = 'abort' then
    if p_reservation <> '' and s.reservation = p_reservation then
      s.reservation := null; s.reservation_expires := null; s.reservation_resets := false;
    end if;
  elsif p_action = 'reserve' then
    if s.reservation is not null and s.reservation_expires > ms then
      return jsonb_build_object('status', 'busy');
    end if;
    if required_until > ms and not (
      p_token <> '' and current_challenge->>'client' = p_client
      and (current_challenge->>'verified')::boolean and (current_challenge->>'expires')::bigint > ms
    ) is true then
      select count(*) into challenge_count from jsonb_object_keys(s.challenges);
      if challenge_count >= 32 then return jsonb_build_object('status', 'busy'); end if;
      s.challenges := s.challenges || jsonb_build_object(p_new_token, jsonb_build_object(
        'answer', p_new_answer, 'client', p_client, 'expires', required_until, 'verified', false));
      update public.fanzzy_otp_captcha_state_v1 set sent_at = s.sent_at, challenges = s.challenges,
        updated_at = s.updated_at where phone_key = p_phone;
      return jsonb_build_object('status', 'challenge', 'expiresAt', required_until);
    end if;
    s.reservation := p_reservation; s.reservation_expires := ms + 120000; s.reservation_resets := required_until > ms;
  elsif required_until <= ms then
    return jsonb_build_object('status', 'not-required');
  elsif p_action = 'refresh' then
    if p_token = '' or current_challenge is null or current_challenge->>'client' is distinct from p_client or (current_challenge->>'expires')::bigint <= ms then
      return jsonb_build_object('status', 'invalid');
    end if;
    s.challenges := (s.challenges - p_token) || jsonb_build_object(p_new_token, jsonb_build_object(
      'answer', p_new_answer, 'client', p_client, 'expires', required_until, 'verified', false));
  elsif p_action = 'verify' then
    if p_token = '' or current_challenge is null or current_challenge->>'client' is distinct from p_client or (current_challenge->>'expires')::bigint <= ms or current_challenge->>'answer' is distinct from p_answer then
      select count(*) into challenge_count from jsonb_object_keys(s.challenges);
      if challenge_count >= 32 and current_challenge is null then return jsonb_build_object('status', 'busy'); end if;
      s.challenges := (s.challenges - p_token) || jsonb_build_object(p_new_token, jsonb_build_object(
        'answer', p_new_answer, 'client', p_client, 'expires', required_until, 'verified', false));
    else
      s.challenges := jsonb_set(s.challenges, array[p_token, 'verified'], 'true'::jsonb);
    end if;
  end if;

  update public.fanzzy_otp_captcha_state_v1 set sent_at = s.sent_at, challenges = s.challenges,
    reservation = s.reservation, reservation_expires = s.reservation_expires,
    reservation_resets = s.reservation_resets, last_committed_reservation = s.last_committed_reservation,
    updated_at = s.updated_at where phone_key = p_phone;
  return jsonb_build_object('status', case
    when p_action = 'reserve' then 'ready' when p_action = 'commit' then 'committed'
    when p_action = 'abort' then 'aborted' when p_action = 'refresh' then 'refreshed'
    when (s.challenges -> p_token ->> 'verified')::boolean is true then 'verified' else 'incorrect' end, 'expiresAt', required_until);
end;
$$;
revoke all on function public.fanzzy_otp_captcha_op_v1(text,text,text,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.fanzzy_otp_captcha_op_v1(text,text,text,text,text,text,text,text) to service_role;
commit;

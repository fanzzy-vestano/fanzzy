-- Runs only against a local disposable transaction after the new migration.
do $$
begin
  if has_table_privilege('anon', 'public.fanzzy_otp_captcha_state_v1', 'select')
     or has_table_privilege('authenticated', 'public.fanzzy_otp_captcha_state_v1', 'select')
     or has_function_privilege('anon', 'public.fanzzy_otp_captcha_op_v1(text,text,text,text,text,text,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.fanzzy_otp_captcha_op_v1(text,text,text,text,text,text,text,text)', 'execute') then
    raise exception 'CAPTCHA storage must not be accessible to customers';
  end if;
end $$;

set local role service_role;
do $$
declare
  phone text := repeat('p', 32);
  client text := repeat('c', 32);
  result jsonb;
  i integer;
  old_times bigint[];
begin
  for i in 1..4 loop
    result := public.fanzzy_otp_captcha_op_v1('reserve', phone, client, '', '', 'new-' || i, 'answer', 'res-' || i);
    if result->>'status' <> 'ready' then raise exception 'Attempt % was not ready: %', i, result; end if;
    result := public.fanzzy_otp_captcha_op_v1('commit', phone, client, '', '', '', '', 'res-' || i);
    if result->>'status' <> 'committed' then raise exception 'Attempt % was not committed', i; end if;
  end loop;
  result := public.fanzzy_otp_captcha_op_v1('reserve', phone, client, '', '', 'token-1', 'answer-1', 'res-5');
  if result->>'status' <> 'challenge' then raise exception 'Fifth attempt bypassed CAPTCHA: %', result; end if;
  result := public.fanzzy_otp_captcha_op_v1('verify', phone, client, 'token-1', 'wrong', 'token-2', 'answer-2', '');
  if result->>'status' <> 'incorrect' then raise exception 'Wrong answer was accepted'; end if;
  result := public.fanzzy_otp_captcha_op_v1('verify', phone, client, 'token-2', 'answer-2', 'token-3', 'answer-3', '');
  if result->>'status' <> 'verified' then raise exception 'Correct answer was rejected: %', result; end if;
  result := public.fanzzy_otp_captcha_op_v1('reserve', phone, client, '', '', 'bypass-token', 'bypass-answer', 'res-bypass');
  if result->>'status' <> 'challenge' then raise exception 'Unverified request bypassed CAPTCHA'; end if;
  result := public.fanzzy_otp_captcha_op_v1('reserve', phone, client, 'token-2', '', 'unused', 'unused', 'res-5');
  if result->>'status' <> 'ready' then raise exception 'Previously verified CAPTCHA was lost: %', result; end if;
  result := public.fanzzy_otp_captcha_op_v1('reserve', phone, client, 'token-2', '', 'unused', 'unused', 'concurrent');
  if result->>'status' <> 'busy' then raise exception 'Concurrent OTP request was not blocked'; end if;
  perform public.fanzzy_otp_captcha_op_v1('abort', phone, client, '', '', '', '', 'res-5');
  result := public.fanzzy_otp_captcha_op_v1('reserve', phone, client, 'token-2', '', 'unused', 'unused', 'res-5-retry');
  if result->>'status' <> 'ready' then raise exception 'Failed delivery lost verified CAPTCHA'; end if;
  perform public.fanzzy_otp_captcha_op_v1('commit', phone, client, '', '', '', '', 'res-5-retry');
  result := public.fanzzy_otp_captcha_op_v1('commit', phone, client, '', '', '', '', 'res-5-retry');
  if result->>'status' <> 'committed' then raise exception 'Commit retry was not idempotent'; end if;
  select sent_at into old_times from public.fanzzy_otp_captcha_state_v1 where phone_key = phone;
  if array_length(old_times, 1) <> 1 then raise exception 'CAPTCHA cycle did not reset'; end if;
  result := public.fanzzy_otp_captcha_op_v1('reserve', phone, client, '', '', 'new', 'answer', 'res-6');
  if result->>'status' <> 'ready' then raise exception 'Next cycle was blocked'; end if;
  update public.fanzzy_otp_captcha_state_v1 set sent_at = array[1,2,3,4]::bigint[], reservation = null where phone_key = phone;
  result := public.fanzzy_otp_captcha_op_v1('reserve', phone, client, '', '', 'new', 'answer', 'expired');
  if result->>'status' <> 'ready' then raise exception 'Old attempts did not expire'; end if;
end $$;

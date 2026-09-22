-- =============================================================================
-- TIPSTAR — SECTION 02: TELEGRAM SESSION UPSERT
-- =============================================================================
-- Adds the atomic, idempotent server-side operation backing
-- supabase/functions/telegram-init-auth: given a Telegram-validated user,
-- resolve or create exactly one internal `users` row keyed on
-- `telegram_identities.telegram_user_id`, without ever resetting
-- user-controlled/internal fields (status, roles, subscriptions, historical
-- preferences) on repeat logins.
--
-- Never edit 20260919000000_init_schema.sql — this is a new migration.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- upsert_telegram_user: the only supported way to create/refresh a user from
-- a validated Telegram identity. SECURITY DEFINER so it can write across
-- `users` / `user_roles` / `telegram_identities` / `notification_preferences`
-- regardless of caller RLS, but execution is restricted to `service_role`
-- below — the backend calls this only after `@tipstar/telegram`'s
-- `validateInitData()` (or its Deno mirror) has cryptographically verified
-- the Telegram payload. Nothing here trusts a client-supplied user id.
-- -----------------------------------------------------------------------------
create or replace function upsert_telegram_user(
  p_telegram_user_id bigint,
  p_username text,
  p_first_name text,
  p_last_name text,
  p_language_code text,
  p_is_premium boolean
) returns table (
  user_id uuid,
  status user_status,
  language_code text,
  created_at timestamptz,
  last_active_at timestamptz,
  is_new_user boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_is_new boolean := false;
begin
  select ti.user_id into v_user_id
  from telegram_identities ti
  where ti.telegram_user_id = p_telegram_user_id
  for update;

  if v_user_id is null then
    insert into users (language_code, last_active_at)
    values (p_language_code, now())
    returning id into v_user_id;

    insert into telegram_identities (user_id, telegram_user_id, telegram_username, first_name, last_name, is_premium)
    values (v_user_id, p_telegram_user_id, p_username, p_first_name, p_last_name, p_is_premium)
    on conflict (telegram_user_id) do nothing;

    if not found then
      -- Lost a race with a concurrent call for the same Telegram user:
      -- discard the orphaned `users` row we just created and resolve the
      -- identity the other call actually persisted, keeping this operation
      -- idempotent under concurrency, not just under sequential retries.
      delete from users where id = v_user_id;
      select ti.user_id into v_user_id
      from telegram_identities ti
      where ti.telegram_user_id = p_telegram_user_id;
    else
      v_is_new := true;
      insert into user_roles (user_id, role) values (v_user_id, 'user') on conflict do nothing;
      insert into notification_preferences (user_id) values (v_user_id) on conflict do nothing;
    end if;
  else
    -- Returning user: refresh Telegram-supplied display fields only. Never
    -- touch status, roles, subscriptions, or referral attribution here —
    -- those are internal/user-controlled and must survive re-authentication.
    update telegram_identities
    set telegram_username = p_username,
        first_name = p_first_name,
        last_name = p_last_name,
        is_premium = p_is_premium
    where telegram_identities.user_id = v_user_id;
  end if;

  update users
  set last_active_at = now(),
      language_code = coalesce(p_language_code, users.language_code)
  where id = v_user_id;

  return query
  select u.id, u.status, u.language_code, u.created_at, u.last_active_at, v_is_new
  from users u
  where u.id = v_user_id;
end;
$$;

revoke all on function upsert_telegram_user(bigint, text, text, text, text, boolean) from public;
grant execute on function upsert_telegram_user(bigint, text, text, text, text, boolean) to service_role;

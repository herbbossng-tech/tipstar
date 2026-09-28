-- RLS policies and column-level grants (Section 03 — RLS Design / Users
-- RLS / Admin-Owner RLS / License RLS / License Key Protection).
--
-- General shape used throughout: no policy for an operation means that
-- operation is fully denied for that role once RLS is enabled — there is
-- no "USING (true)" or "WITH CHECK (true)" anywhere in this file for a
-- sensitive table. service_role bypasses RLS entirely (a Postgres/
-- Supabase built-in property of that role, not something granted here)
-- and is therefore the only role permitted to insert/mutate the tables
-- that ordinary users must never write to directly (licenses,
-- license_entitlements, license_limits, auth_sessions, audit_logs,
-- platform_settings, and users.role/users.status).

-- Defensive baseline: strip whatever ambient default privileges Supabase
-- may have granted anon/authenticated on these tables when they were
-- created (this repo's local test harness cannot fully replicate
-- Supabase's managed-instance default privilege scheme, so start from
-- zero explicitly rather than assuming it matches). Every grant this
-- file actually intends is re-added narrowly below.
revoke all on public.users, public.licenses, public.license_entitlements, public.license_limits, public.auth_sessions, public.audit_logs, public.platform_settings
  from anon, authenticated;

-- ============================================================
-- users
-- ============================================================

-- Self, or an admin/owner, may read a row. All columns are readable —
-- nothing on `users` is secret (telegram_user_id is documented as safe
-- to display; role/status must be readable so a user can see their own
-- state, e.g. "your account is suspended").
grant select on public.users to authenticated;

create policy users_select_self_or_admin
  on public.users for select
  using (id = public.current_app_user_id() or public.is_admin());

-- Column allowlist: telegram_user_id, is_premium, last_authenticated_at,
-- created_at, updated_at, id are NEVER granted to `authenticated` at
-- all — nobody, self or admin, edits those through this path (identity
-- fields only ever change via upsertAuthenticatedTelegramUser(), which
-- runs as service_role). role and status ARE granted here because an
-- admin/owner genuinely needs to write them through this path — but a
-- column GRANT is per-Postgres-role, and `authenticated` is the ONE
-- shared Postgres role for every app-level role (user/admin/owner
-- alike), so the grant alone cannot stop a plain USER from attempting
-- it. That per-row distinction is enforced by the
-- enforce_user_self_service_boundaries trigger (see its migration),
-- which layers on top of this grant and the policy below.
grant update (username, first_name, last_name, language_code, role, status) on public.users to authenticated;

create policy users_update_self_or_admin
  on public.users for update
  using (id = public.current_app_user_id() or public.is_admin())
  with check (id = public.current_app_user_id() or public.is_admin());

-- No INSERT/DELETE policy for authenticated/anon at all: user creation
-- only ever happens via upsertAuthenticatedTelegramUser() (service-role).
-- This is what makes "User cannot insert an OWNER" true at the database
-- level — there is no path for the authenticated role to INSERT a row
-- into users under any role value whatsoever.

-- ============================================================
-- licenses
-- ============================================================

-- license_key and created_by are deliberately excluded from this grant —
-- see the column comment on licenses.license_key. Any legitimate reason
-- to view a raw key belongs in a dedicated, audited, service-role-backed
-- operation, not an ordinary SELECT.
grant select (id, user_id, plan, status, starts_at, expires_at, max_devices, created_at, updated_at, revoked_at) on public.licenses to authenticated;

create policy licenses_select_self_or_admin
  on public.licenses for select
  using (user_id = public.current_app_user_id() or public.is_admin());

grant insert, update, delete on public.licenses to authenticated;

create policy licenses_admin_write
  on public.licenses for all
  using (public.is_admin())
  with check (public.is_admin());

-- No self-write policy at all: a USER can never insert/update/delete
-- their own license row, satisfying "USER may not modify license
-- status/key/entitlements/limits" unconditionally.

-- ============================================================
-- license_entitlements
-- ============================================================

grant select on public.license_entitlements to authenticated;

create policy license_entitlements_select_self_or_admin
  on public.license_entitlements for select
  using (
    public.is_admin()
    or exists (
      select 1 from public.licenses l
      where l.id = license_entitlements.license_id
        and l.user_id = public.current_app_user_id()
    )
  );

grant insert, update, delete on public.license_entitlements to authenticated;

create policy license_entitlements_admin_write
  on public.license_entitlements for all
  using (public.is_admin())
  with check (public.is_admin());

-- ============================================================
-- license_limits
-- ============================================================

grant select on public.license_limits to authenticated;

create policy license_limits_select_self_or_admin
  on public.license_limits for select
  using (
    public.is_admin()
    or exists (
      select 1 from public.licenses l
      where l.id = license_limits.license_id
        and l.user_id = public.current_app_user_id()
    )
  );

grant insert, update, delete on public.license_limits to authenticated;

create policy license_limits_admin_write
  on public.license_limits for all
  using (public.is_admin())
  with check (public.is_admin());

-- ============================================================
-- auth_sessions
-- ============================================================

-- token_hash is excluded from the grant: nothing legitimate in the
-- frontend needs it, so it is simply not exposed (data minimization —
-- a hash alone is not usable as a bearer credential, but there is no
-- reason to expose it either).
grant select (id, user_id, session_id, issued_at, expires_at, revoked_at, revoked_reason, created_at) on public.auth_sessions to authenticated;

create policy auth_sessions_select_self_or_admin
  on public.auth_sessions for select
  using (user_id = public.current_app_user_id() or public.is_admin());

-- No INSERT/UPDATE/DELETE policy for authenticated/anon: sessions are
-- only ever issued/revoked by server-side code via the service role.

-- ============================================================
-- audit_logs
-- ============================================================

grant select on public.audit_logs to authenticated;

create policy audit_logs_select_admin_only
  on public.audit_logs for select
  using (public.is_admin());

-- No INSERT/UPDATE/DELETE policy for authenticated/anon at all: audit
-- events are only ever written by server-side code via the service
-- role, from the trusted operation itself — never client-initiated, and
-- never mutated once written (append-only).

-- ============================================================
-- platform_settings
-- ============================================================

-- Deliberately no GRANT and no policy for anon/authenticated at all —
-- only service_role (bypassing RLS) may ever touch this table. The
-- preamble's REVOKE ALL already covers it; nothing further is granted.

-- ============================================================
-- service_role
-- ============================================================

-- A hosted Supabase project grants service_role full privileges on the
-- public schema by default (it also carries BYPASSRLS, which is a
-- separate mechanism from ordinary GRANTs — BYPASSRLS skips row-level
-- policies, not table/column privilege checks). This repo's local test
-- harness defines service_role itself (see the RLS test setup script),
-- so it does not inherit that managed-instance default automatically;
-- grant explicitly here so local tests reflect real Supabase behavior.
grant all on public.users, public.licenses, public.license_entitlements, public.license_limits, public.auth_sessions, public.audit_logs, public.platform_settings
  to service_role;

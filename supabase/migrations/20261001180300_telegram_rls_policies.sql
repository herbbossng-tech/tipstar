-- RLS policies and grants for the Section 10 Telegram publishing schema.
-- Same shape as every prior section's operational tables
-- (agent_invocations, market_observations, settlements, ...): no
-- `USING (true)` write policy anywhere, and no INSERT/UPDATE/DELETE
-- policy for anon/authenticated on either table — every write happens
-- through a service-role-backed repository
-- (packages/agents/src/db/repositories.ts) that has ALREADY performed
-- its own requireOwner()/requireAdmin() check (destinations) or its own
-- Publishing Policy Engine + PublishingAuthorizer check (publications)
-- before it ever reaches these tables. "An ordinary USER must not be
-- able to create or modify a destination, create a fake publication
-- record, modify a publication's status, or inject a telegram_message_id."

revoke all on
  public.telegram_destinations, public.telegram_publications
  from anon, authenticated;

grant select on
  public.telegram_destinations, public.telegram_publications
  to authenticated;

create policy telegram_destinations_select_admin_only on public.telegram_destinations for select using (public.is_admin());
create policy telegram_publications_select_admin_only on public.telegram_publications for select using (public.is_admin());

grant all on
  public.telegram_destinations, public.telegram_publications
  to service_role;

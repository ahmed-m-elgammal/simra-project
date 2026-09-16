-- 004_revenue_apply.sql — atomic webhook apply (marker + entitlement in one transaction).
--
-- The Edge route previously recorded the idempotency marker (revenue_events
-- insert) and then applied the grant/revoke in a SECOND round trip. A failure
-- between the two committed the marker but left the mutation unapplied; the
-- RevenueCat retry then hit the marker path, returned 200, and the event's
-- effect was lost permanently (paid user stays locked, refund keeps access).
--
-- apply_revenue_event copies the claim_free pattern (security definer, single
-- transaction): insert the marker with ON CONFLICT DO NOTHING and, only when
-- this call is the one that recorded the event, apply grant or revoke. A
-- replay returns inserted=false and re-applies nothing. Action classification
-- (grant/revoke/none) stays in the Edge route; the RPC stays dumb by design.

create or replace function public.apply_revenue_event(
  p_event_id text,
  p_app_user_id text,
  p_book_id text,
  p_type text,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  recorded boolean;
begin
  if nullif(trim(p_event_id), '') is null or nullif(trim(p_app_user_id), '') is null then
    raise exception 'invalid revenue event identity';
  end if;

  if p_action not in ('grant', 'revoke', 'none') then
    raise exception 'invalid revenue event action';
  end if;

  insert into revenue_events (event_id, app_user_id, book_id, type)
  values (p_event_id, p_app_user_id, coalesce(p_book_id, ''), p_type)
  on conflict (event_id) do nothing;

  -- FOUND is true only when this call actually inserted the marker row.
  recorded := found;

  if recorded and p_action = 'grant' and nullif(trim(p_book_id), '') is not null then
    insert into entitlements (app_user_id, book_id, source)
    values (p_app_user_id, p_book_id, 'revenuecat')
    on conflict (app_user_id, book_id) do update set source = excluded.source;
  elsif recorded and p_action = 'revoke' and nullif(trim(p_book_id), '') is not null then
    delete from entitlements
    where app_user_id = p_app_user_id and book_id = p_book_id;
  end if;

  return jsonb_build_object('inserted', recorded);
end;
$$;

revoke all on function public.apply_revenue_event(text, text, text, text, text) from public;
grant execute on function public.apply_revenue_event(text, text, text, text, text) to service_role;

alter table books add column description text not null default '';

create or replace function public.claim_free(
  p_app_user_id text,
  p_book_id text,
  p_enforce_limit boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  claim_count integer;
begin
  if nullif(trim(p_app_user_id), '') is null or nullif(trim(p_book_id), '') is null then
    raise exception 'invalid claim identity';
  end if;

  -- Serialize claims per anonymous user so count + insert is atomic under concurrency.
  perform pg_advisory_xact_lock(hashtextextended(p_app_user_id, 0));

  if not exists (select 1 from books where id = p_book_id and status = 'published') then
    return jsonb_build_object('status', 'not_found');
  end if;

  select count(*)::integer into claim_count
  from free_claims
  where app_user_id = p_app_user_id;

  if exists (select 1 from free_claims where app_user_id = p_app_user_id and book_id = p_book_id) then
    return jsonb_build_object(
      'status', 'claimed',
      'already_claimed', true,
      'remaining', greatest(0, 3 - claim_count)
    );
  end if;

  if p_enforce_limit and claim_count >= 3 then
    return jsonb_build_object('status', 'limit_reached', 'remaining', 0);
  end if;

  insert into free_claims (app_user_id, book_id) values (p_app_user_id, p_book_id);
  return jsonb_build_object(
    'status', 'claimed',
    'already_claimed', false,
    'remaining', greatest(0, 3 - (claim_count + 1))
  );
end;
$$;

revoke all on function public.claim_free(text, text, boolean) from public;
grant execute on function public.claim_free(text, text, boolean) to service_role;

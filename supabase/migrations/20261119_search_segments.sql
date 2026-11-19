-- Full-text search over segment.tsv (GIN). Not expressible cleanly via PostgREST filters.
create or replace function search_segments(
  uid uuid,
  q text,
  prefix_q text,
  kinds text[],
  use_ilike boolean,
  ilike_pat text,
  lim int
)
returns table (
  id text,
  save_id text,
  modality text,
  loc_kind text,
  loc_start int,
  loc_end int,
  text text,
  title text,
  rank double precision
)
language sql
stable
as $$
  with qq as (
    select
      case
        when coalesce(nullif(trim(prefix_q), ''), '') = '' then websearch_to_tsquery('english', q)
        else websearch_to_tsquery('english', q) || to_tsquery('english', prefix_q)
      end as tq
  )
  select
    seg.id,
    seg.save_id,
    seg.modality,
    seg.loc_kind,
    seg.loc_start,
    seg.loc_end,
    seg.text,
    s.title,
    ts_rank(seg.tsv, qq.tq)::float8 as rank
  from segment seg
  join save s on s.id = seg.save_id and s.user_id = uid and s.deleted_at is null
  cross join qq
  where seg.user_id = uid
    and (kinds is null or s.kind = any (kinds))
    and (seg.tsv @@ qq.tq or (use_ilike and s.title ilike ilike_pat escape '\'))
  order by rank desc
  limit lim;
$$;

revoke all on function search_segments(uuid, text, text, text[], boolean, text, int) from public;
grant execute on function search_segments(uuid, text, text, text[], boolean, text, int) to service_role;
grant execute on function search_segments(uuid, text, text, text[], boolean, text, int) to authenticated;

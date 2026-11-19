# Apply Supabase Migration

## Option 1: Supabase Dashboard (SQL Editor)

1. Create or open your project in the [Supabase Dashboard](https://supabase.com/dashboard).
2. Open **SQL Editor** → **New query**.
3. Paste the full contents of `supabase/migrations/20261119_init.sql` and click **Run**.

## Option 2: Supabase CLI

```bash
supabase login
supabase link --project-ref <your-project-ref>
supabase db push
```

## Verify

Run in **SQL Editor**:

```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('save', 'asset', 'segment', 'board', 'board_item', 'idempotency', 'job')
order by tablename;

select id, name, public
from storage.buckets
where id = 'atelier-assets';
```

Expected: all 7 tables return `rowsecurity = true`, and `atelier-assets` exists with `public = false` (object keys use `{user_id}/{asset_id}`).

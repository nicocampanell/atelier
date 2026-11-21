-- Atelier initial schema, storage bucket, and owner RLS policies for Supabase.

create table if not exists save (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  source_url text,
  normalized_url text,
  title text not null,
  title_user boolean not null default false,
  description text,
  preview_url text,
  status text not null,
  error text,
  duplicate_of text,
  note text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  extracted_text text,
  tags text[]
);
create index if not exists save_user_created_idx on save (user_id, created_at desc, id desc);
create index if not exists save_user_url_idx on save (user_id, normalized_url);

create table if not exists asset (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  save_id text not null,
  media_type text not null,
  bytes integer not null,
  storage_path text not null,
  created_at timestamptz not null default now()
);
create index if not exists asset_save_idx on asset (user_id, save_id);

create table if not exists segment (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  save_id text not null,
  modality text not null,
  loc_kind text not null,
  loc_start int not null,
  loc_end int,
  text text,
  tsv tsvector generated always as (to_tsvector('english', coalesce(text, ''))) stored,
  embedding real[]
);
create index if not exists segment_tsv_idx on segment using gin (tsv);
create index if not exists segment_user_save_idx on segment (user_id, save_id);

create table if not exists board (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null default 'Moodboard',
  camera jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists board_user_created_idx on board (user_id, created_at, id);

-- pos preserves the order the client sent items in.
-- Item ids only need to be unique within a board (projects may reuse ids).
create table if not exists board_item (
  id text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  board_id text not null,
  pos integer not null default 0,
  type text not null,
  save_id text,
  text text,
  x double precision not null,
  y double precision not null,
  w double precision not null,
  h double precision not null,
  z double precision not null,
  primary key (user_id, board_id, id)
);
create index if not exists board_item_board_idx on board_item (user_id, board_id, pos);
create index if not exists board_item_save_idx on board_item (user_id, save_id);

create table if not exists idempotency (
  user_id uuid not null references auth.users (id) on delete cascade,
  key text not null,
  save_id text not null,
  project_id text,
  item_id text,
  created_at timestamptz not null default now(),
  primary key (user_id, key)
);

create table if not exists job (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  save_id text,
  kind text not null,
  status text not null,
  attempts int not null default 0,
  last_error text,
  updated_at timestamptz not null default now()
);

alter table save enable row level security;
create policy save_owner on save
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table asset enable row level security;
create policy asset_owner on asset
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table segment enable row level security;
create policy segment_owner on segment
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table board enable row level security;
create policy board_owner on board
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table board_item enable row level security;
create policy board_item_owner on board_item
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table idempotency enable row level security;
create policy idempotency_owner on idempotency
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table job enable row level security;
create policy job_owner on job
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

insert into storage.buckets (id, name, public)
values ('atelier-assets', 'atelier-assets', false)
on conflict (id) do update set public = false;

create policy asset_objects_owner on storage.objects
  for all using (
    bucket_id = 'atelier-assets' and auth.uid()::text = (storage.foldername(name))[1]
  ) with check (
    bucket_id = 'atelier-assets' and auth.uid()::text = (storage.foldername(name))[1]
  );

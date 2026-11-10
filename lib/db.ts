import { mkdir } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

type G = typeof globalThis & { __atelierDb?: Promise<PGlite> };
const g = globalThis as G;

/** Root of all local data (database + uploaded files). Read lazily. */
export function getDataDir(): string {
  return path.resolve(process.env.ATELIER_DATA_DIR ?? "./.data");
}

const SCHEMA = `
create table if not exists save (
  id text primary key,
  user_id text not null,
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
  extracted_text text
);
create index if not exists save_user_created_idx on save (user_id, created_at desc, id desc);
create index if not exists save_user_url_idx on save (user_id, normalized_url);

create table if not exists asset (
  id text primary key,
  user_id text not null,
  save_id text not null,
  media_type text not null,
  bytes integer not null,
  storage_path text not null,
  created_at timestamptz not null default now()
);
create index if not exists asset_save_idx on asset (user_id, save_id);

create table if not exists segment (
  id text primary key,
  user_id text not null,
  save_id text not null,
  modality text not null,
  loc_kind text not null,
  loc_start int not null,
  loc_end int,
  text text,
  tsv tsvector generated always as (to_tsvector('english', coalesce(text,''))) stored,
  embedding real[]
);
create index if not exists segment_tsv_idx on segment using gin (tsv);
create index if not exists segment_user_save_idx on segment (user_id, save_id);

create table if not exists board (
  id text primary key,
  user_id text not null unique,
  camera jsonb not null
);

-- pos preserves the order the client sent items in.
create table if not exists board_item (
  id text not null,
  user_id text not null,
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
  primary key (user_id, id)
);
create index if not exists board_item_board_idx on board_item (user_id, board_id, pos);
create index if not exists board_item_save_idx on board_item (user_id, save_id);

create table if not exists job (
  id text primary key,
  user_id text not null,
  save_id text,
  kind text not null,
  status text not null,
  attempts int not null default 0,
  last_error text,
  updated_at timestamptz not null default now()
);
`;

async function open(): Promise<PGlite> {
  const dir = path.join(getDataDir(), "db");
  await mkdir(dir, { recursive: true });
  const db = new PGlite(dir);
  await db.waitReady;
  await db.exec(SCHEMA);
  // Re-queue saves a previous process left in accepted/processing. Fire and
  // forget; it must not block (or deadlock on) database initialisation.
  setTimeout(() => {
    import("./jobs").then((m) => m.requeueStuck()).catch(() => {});
  }, 0);
  return db;
}

export function getDb(): Promise<PGlite> {
  if (!g.__atelierDb) {
    const p = open();
    g.__atelierDb = p;
    p.catch(() => {
      if (g.__atelierDb === p) g.__atelierDb = undefined;
    });
  }
  return g.__atelierDb;
}

export async function closeDb(): Promise<void> {
  const p = g.__atelierDb;
  g.__atelierDb = undefined;
  if (p) {
    const db = await p.catch(() => null);
    await db?.close();
  }
}

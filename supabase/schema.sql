-- Blend data model (PRD "Data model"). Run in the Supabase SQL editor.
-- The API uses the service-role key server-side; keys never reach the app.

create table if not exists artworks (
  id text primary key, title text not null, artist text, year int not null, medium text not null,
  image_url text not null, source_url text not null, license text not null,
  variables jsonb not null, clip_embedding jsonb not null
);

create table if not exists quiz_rounds (
  round int primary key, artwork_ids text[] not null check (array_length(artwork_ids, 1) = 4),
  design_note text
);

create table if not exists users (
  id text primary key,               -- device id
  display_name text not null,
  created_at timestamptz not null default now()
);

create table if not exists galleries (
  user_id text primary key references users(id) on delete cascade,
  artwork_ids text[] not null,
  means jsonb not null, spreads jsonb not null, centroid jsonb not null,
  title text not null, summary jsonb not null default '{}',
  blend_tiles jsonb not null default '[]',
  updated_at timestamptz not null default now()
);

create table if not exists sessions (
  code text primary key, host_id text not null references users(id),
  guest_id text references users(id), status text not null default 'waiting',
  blend_id text, expires_at timestamptz not null, created_at timestamptz not null default now()
);

create table if not exists blends (
  id text primary key, session_code text, user_a text not null, user_b text not null,
  status text not null, score int, per_variable jsonb, pairs jsonb, groups jsonb, targets jsonb,
  "references" jsonb, medium text, prompt text, still_source text, painting_variables jsonb,
  gallery_a jsonb, gallery_b jsonb, names jsonb,
  still_url text, thumb_url text, video_url text,
  panel jsonb, panel_status text, video_status text,
  cache_key text, timings jsonb, error text, events jsonb not null default '[]',
  created_at timestamptz not null default now()
);
create index if not exists blends_cache_key on blends(cache_key);

-- Live readiness: realtime on sessions (the app also polls GET /session/:code as a fallback).
alter publication supabase_realtime add table sessions;

-- Public bucket for stills, MP4s and thumbnails.
insert into storage.buckets (id, name, public) values ('blend', 'blend', true)
on conflict (id) do nothing;

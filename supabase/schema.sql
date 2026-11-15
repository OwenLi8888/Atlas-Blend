create table profiles (
  id uuid primary key default gen_random_uuid(),
  name text,
  blend_code text unique default upper(substr(md5(random()::text),1,6)),
  -- The painter the person chose, and what they call it; null until they choose.
  painter_id text,
  painter_name text,
  created_at timestamptz default now()
);

create table hearts (
  user_id uuid references profiles(id) on delete cascade,
  art_id text not null,
  why text,
  created_at timestamptz default now(),
  primary key (user_id, art_id)
);

create table blends (
  id uuid primary key default gen_random_uuid(),
  user_a uuid references profiles(id) on delete cascade,
  user_b uuid references profiles(id) on delete cascade,
  top_art_id text,
  picks jsonb,
  story text,
  -- Everything needed to show the blend again: score, wall, both people's leanings.
  result jsonb,
  created_at timestamptz default now()
);

alter table profiles enable row level security;
alter table hearts enable row level security;
alter table blends enable row level security;

-- Signing up in one transaction: the profile and its first hearts together or not at all.
create or replace function create_profile(p_id uuid, p_name text, p_blend_code text, p_art_ids text[], p_painter_id text)
returns profiles
language plpgsql
as $$
declare
  made profiles;
begin
  insert into profiles (id, name, blend_code, painter_id) values (p_id, p_name, p_blend_code, p_painter_id) returning * into made;
  insert into hearts (user_id, art_id) select made.id, art_id from unnest(p_art_ids) as art_id;
  return made;
end;
$$;

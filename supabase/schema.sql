create table profiles (
  id uuid primary key default gen_random_uuid(),
  name text,
  blend_code text unique default upper(substr(md5(random()::text),1,6)),
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
  created_at timestamptz default now()
);

alter table profiles enable row level security;
alter table hearts enable row level security;
alter table blends enable row level security;
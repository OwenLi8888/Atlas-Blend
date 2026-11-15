-- A person's painter is kept on their profile, so it follows them to any device
-- and is the one their friends see in a blend. Run once in the Supabase SQL
-- editor. Until it is run the server still works: profiles have no painter of
-- their own and choosing one answers with an error.
alter table profiles
  add column if not exists painter_id text,
  add column if not exists painter_name text;

-- Signing up now saves the painter chosen at the entrance in the same
-- transaction. This replaces the function from 002_create_profile.sql.
drop function if exists create_profile(uuid, text, text, text[]);

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

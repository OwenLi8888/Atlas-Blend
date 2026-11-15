-- Signing up in one transaction: the profile and its first hearts are saved
-- together or not at all. Run once in the Supabase SQL editor. Until it is run
-- the server still signs people up, in two steps that it undoes on failure.
-- The function runs with the caller's rights, so row level security still
-- keeps everyone but the server (which holds the secret key) out.
create or replace function create_profile(p_id uuid, p_name text, p_blend_code text, p_art_ids text[])
returns profiles
language plpgsql
as $$
declare
  made profiles;
begin
  insert into profiles (id, name, blend_code) values (p_id, p_name, p_blend_code) returning * into made;
  insert into hearts (user_id, art_id) select made.id, art_id from unnest(p_art_ids) as art_id;
  return made;
end;
$$;

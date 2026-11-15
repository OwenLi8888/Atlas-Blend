-- Lets a saved blend be reopened later: the score, the shared wall and both
-- people's leanings are kept with it. Run once in the Supabase SQL editor.
-- Blends saved before this have no result and are not listed.
alter table blends add column if not exists result jsonb;

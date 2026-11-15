-- A passcode a person can set, so their code alone does not open their gallery.
-- Only its salted hash is kept. Run once in the Supabase SQL editor. Until it is
-- run the server still works: nobody has a passcode, setting one answers with
-- an error, and a code alone signs in.
alter table profiles
  add column if not exists passcode_hash text,
  -- Lower case; what a person signs in with instead of their code.
  add column if not exists username text unique;

notify pgrst, 'reload schema';

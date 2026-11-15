-- A username and passcode a person can set, to open their gallery on another
-- browser. Only the passcode's salted hash is kept. Run once in the Supabase SQL
-- editor. Until it is run the server still works, but nobody can set them or
-- sign in.
alter table profiles
  add column if not exists passcode_hash text,
  -- Lower case; what a person signs in with instead of their code.
  add column if not exists username text unique;

notify pgrst, 'reload schema';

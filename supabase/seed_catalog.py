"""Emit SQL inserts for the artworks + quiz_rounds tables from catalog/data (pipe into psql or
paste into the SQL editor):  python supabase/seed_catalog.py > seed.sql"""
import json
import sys

sys.stdout.reconfigure(encoding="utf-8")
from pathlib import Path

D = Path(__file__).resolve().parents[1] / "catalog" / "data"
q = lambda s: "'" + str(s).replace("'", "''") + "'"
for a in json.loads((D / "artworks.json").read_text(encoding="utf-8")):
    print(f"insert into artworks values ({q(a['id'])},{q(a['title'])},{q(a['artist'])},{a['year']},"
          f"{q(a['medium'])},{q(a['image_url'])},{q(a['source_url'])},{q(a['license'])},"
          f"{q(json.dumps(a['variables']))}::jsonb,{q(json.dumps(a['clip_embedding']))}::jsonb) on conflict do nothing;")
for r in json.loads((D / "quiz_rounds.json").read_text(encoding="utf-8")):
    ids = "array[" + ",".join(q(i) for i in r["artwork_ids"]) + "]"
    print(f"insert into quiz_rounds values ({r['round']},{ids},{q(r['design_note'])}) on conflict do nothing;")

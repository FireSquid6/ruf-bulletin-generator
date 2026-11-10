CREATE TABLE song (
  key text PRIMARY KEY,
  title text NOT NULL,
  parts jsonb NOT NULL,
  columns integer CHECK (columns IN (1, 2)),
  scale double precision CHECK (scale > 0),
  CONSTRAINT song_key_nonempty CHECK (length(trim(key)) > 0),
  CONSTRAINT song_title_nonempty CHECK (length(trim(title)) > 0)
);

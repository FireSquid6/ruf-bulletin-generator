CREATE TABLE invitation (
  id text PRIMARY KEY,
  key_hash text NOT NULL UNIQUE,
  issued_by text NOT NULL REFERENCES "user"(id),
  created_at timestamp NOT NULL DEFAULT now(),
  consumed_at timestamp,
  consumed_by text REFERENCES "user"(id)
);

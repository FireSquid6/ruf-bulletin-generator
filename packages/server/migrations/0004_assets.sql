CREATE TABLE IF NOT EXISTS image_asset (
  id uuid PRIMARY KEY,
  name varchar(160) NOT NULL,
  kind varchar(16) NOT NULL CHECK (kind IN ('branding', 'image', 'qr')),
  mime_type varchar(32) NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/gif', 'image/webp')),
  size integer NOT NULL CHECK (size > 0 AND size <= 5242880),
  bytes bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

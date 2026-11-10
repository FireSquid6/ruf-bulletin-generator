CREATE TABLE "mcp_key" (
  "id" text PRIMARY KEY,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "label" text NOT NULL,
  "secret_hash" text NOT NULL UNIQUE,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "revoked_at" timestamp
);
CREATE INDEX "mcp_key_user_id_idx" ON "mcp_key" ("user_id");

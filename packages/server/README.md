# Workspace setup

Use a dedicated Postgres database. Run from the repository root:

```sh
export DATABASE_URL='postgres://user:password@localhost:5432/ruf'
export APP_URL='http://localhost:3000' # use the actual HTTPS public origin in deployment
export BETTER_AUTH_SECRET="$(openssl rand -base64 48)" # store securely; reuse across restarts
bun run --cwd packages/server migrate
bun run --cwd packages/server import-songs # optional one-time legacy catalog import
export ADMIN_EMAIL='admin@example.org' ADMIN_NAME='Administrator'
read -rs -p 'Initial admin password: ' ADMIN_PASSWORD; echo
export ADMIN_PASSWORD
bun run --cwd packages/server bootstrap
unset ADMIN_PASSWORD
bun run build
bun run start
```

Run `bun run --cwd packages/server import-songs` from the repository root with `DATABASE_URL` set after migrations to copy `store/song-store.yaml` into Postgres. This is a one-time staff CLI command, not a web endpoint or continuing sync. It reads the source without changing it, validates the entire file using the generator, and inserts all new keys atomically. Re-running skips existing keys (including songs edited in the web store), so it is safe to retry but will not update or restore them; edit those in the web song store. It does not import weekly bulletin YAML. Imported entries are available in `/songs` and `/api/songs`; song selection in the bulletin editor depends on #8.

The bootstrap command refuses to run once **any** account exists. It has no HTTP route or shared registration secret. Keep `BETTER_AUTH_SECRET` stable: changing it invalidates sessions. Use TLS for non-local origins, restrict database credentials, and never commit `.env` files. Password recovery and email verification are not included. Administrators generate one-use invitation keys in the web workspace at `/invitations`. Copy each key when issued: only its SHA-256 digest is stored and the plaintext cannot be retrieved. Staff register at `/register` using email, password and the invitation key; Better Auth's public sign-up route remains denied.

For integration tests, create a **fresh disposable database**, apply all migrations to it, then set `TEST_DATABASE_URL` to that database's URL and run `bun run build && bun test packages/server/tests/auth.test.ts && bun test packages/server/tests/routes.test.ts packages/server/tests/z-assets.test.ts`. The authentication test creates the first administrator, so run it before image asset tests on the same database. Without `TEST_DATABASE_URL`, Postgres-dependent tests are skipped; CI provisions Postgres and runs both test groups in order.

Drafts are stored in `bulletin` (one row per `gathering_date`). `composition` is a JSON document encoded in the existing text column: `{ "cover": Block[], "flow": Block[] }`. Blocks are ordered, movable objects with a `type` field; this is deliberately independent of physical PDF panels. Branding blocks reference image asset IDs (the default is the logo seeded by `0004_assets`), never local file paths. The future block editor (#5) can extend the block fields without changing this draft CRUD API. PUT requires the last seen `revision`; updates atomically increment it and return 409 for stale edits or duplicate dates.

The `/assets` workspace library stores image bytes and metadata in Postgres. Run migrations before starting the server; migration `0004_assets` installs the existing RUF Baylor logo as the first reusable branding image once. Uploads accept PNG, JPEG, GIF, or WebP up to 5 MB. Deleting an asset does not restore the starter logo or repair bulletin references. The Postgres integration test checks upload, persistent retrieval across app instances, rename, removal, and authentication; run it against a disposable migrated database.

# Workspace setup

Use a dedicated Postgres database. Run from the repository root:

```sh
export DATABASE_URL='postgres://user:password@localhost:5432/ruf'
export APP_URL='http://localhost:3000' # use the actual HTTPS public origin in deployment
export BETTER_AUTH_SECRET="$(openssl rand -base64 48)" # store securely; reuse across restarts
bun run --cwd packages/server migrate
export ADMIN_EMAIL='admin@example.org' ADMIN_NAME='Administrator'
read -rs -p 'Initial admin password: ' ADMIN_PASSWORD; echo
export ADMIN_PASSWORD
bun run --cwd packages/server bootstrap
unset ADMIN_PASSWORD
bun run build
bun run start
```

The bootstrap command refuses to run once **any** account exists. It has no HTTP route or shared registration secret. Keep `BETTER_AUTH_SECRET` stable: changing it invalidates sessions. Use TLS for non-local origins, restrict database credentials, and never commit `.env` files. Password recovery and invitations are not yet implemented; generic Better Auth registration is denied on the server.

For integration tests, create a **fresh disposable database**, apply the migration to it, then set `TEST_DATABASE_URL` to that database's URL and run `bun test packages/server/tests`. The test intentionally creates an administrator and leaves its records in that disposable database. Without `TEST_DATABASE_URL`, the Postgres-dependent test is skipped; the route shell tests still run.

Drafts are stored in `bulletin` (one row per `gathering_date`). `composition` is a JSON document encoded in the existing text column: `{ "cover": Block[], "flow": Block[] }`. Blocks are ordered, movable objects with a `type` field; this is deliberately independent of physical PDF panels. The future block editor (#5) can extend the block fields without changing this draft CRUD API. PUT requires the last seen `revision`; updates atomically increment it and return 409 for stale edits or duplicate dates.

The `/assets` workspace library stores image bytes and metadata in Postgres. Run migrations before starting the server; migration `0004_assets` installs the existing RUF Baylor logo as the first reusable branding image once. Uploads accept PNG, JPEG, GIF, or WebP up to 5 MB. Deleting an asset does not restore the starter logo or repair bulletin references. The Postgres integration test checks upload, persistent retrieval across app instances, rename, removal, and authentication; run it against a disposable migrated database.

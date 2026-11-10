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

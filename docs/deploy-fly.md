# Deploy to Fly.io

The root `Dockerfile` builds the React frontend and runs the Bun server with production dependencies as a non-root user. `fly.toml` exposes port 3000 over HTTPS and runs database migrations in a release Machine before replacing the running app.

## First deployment

Install and authenticate the Fly CLI (`fly auth login`). From the repository root:

1. Choose a globally unique app name. Update both `app` and `APP_URL` in `fly.toml`; change `primary_region` to the region nearest your database. If using a custom domain, use its HTTPS origin for `APP_URL` and configure its Fly certificate/DNS. This origin must match the address staff and MCP clients use.
2. Create the app:

   ```sh
   fly apps create YOUR_APP_NAME
   ```

3. Provision a dedicated Postgres database, preferably Fly Managed Postgres in the same region. Attach it to this app to set `DATABASE_URL`. Alternatively, set a provider's connection URL with `fly secrets set DATABASE_URL='postgres://...'`. Use the provider's required TLS settings for external databases; never disable certificate verification. The app stores accounts, bulletins, songs, and uploaded image bytes in Postgres, so no Fly volume is needed. Configure database backups before storing production data.
4. Set a stable authentication secret and email delivery credentials (never put these in `fly.toml`):

   ```sh
   fly secrets set --stage \
     BETTER_AUTH_SECRET="$(openssl rand -base64 48)" \
     RESEND_API_KEY='YOUR_RESEND_KEY' \
     EMAIL_FROM='RUF Bulletin Studio <bulletins@example.org>'
   ```

   Use a verified Resend sender. To require confirmation of staff email addresses, change `EMAIL_CONFIRMATION` to `"true"` in `fly.toml`. Password recovery still needs email delivery when confirmation is off.
5. Deploy and check the app:

   ```sh
   fly deploy
   fly checks list
   curl --fail https://YOUR_APP_NAME.fly.dev/api/health
   ```

   A migration failure blocks deployment. `/api/health` checks the HTTP process, not database connectivity; also check `fly logs` and sign in after setup.

## First administrator and song catalog

After the first successful deploy, open an interactive shell with `fly ssh console`, then run `bash` and the following inside the Machine:

```sh
export ADMIN_EMAIL='admin@example.org' ADMIN_NAME='Administrator'
read -rs -p 'Initial admin password: ' ADMIN_PASSWORD; echo
export ADMIN_PASSWORD
bun run --cwd packages/server bootstrap
unset ADMIN_PASSWORD
bun run --cwd packages/server import-songs # optional: load the bundled legacy catalog
exit
```

Bootstrap refuses to run if any account already exists. Do not set the administrator password as a persistent Fly secret. Song import skips existing song keys and does not import weekly YAML bulletins. See [server setup](../packages/server/README.md) for account invitations, email settings, and catalog behavior.

## Updates and sizing

Run `fly deploy` for subsequent releases. Migrations run automatically each time; do not run bootstrap on every release. Keep migrations compatible with the old running version during rollout and take a database backup before destructive schema changes. Reverting an image does not undo migrations.

The default shared-CPU Machine has 1 GB RAM and stops when idle (with cold starts on the next request). Set `min_machines_running = 1` to keep a Machine warm in the primary region. Increase memory/CPU if concurrent PDF generation needs it. Database charges are separate from app Machine usage.

## Local image check

```sh
docker build -t ruf-bulletin .
# Supply real database/auth/email configuration in an untracked file.
docker run --rm --env-file .env -p 3000:3000 ruf-bulletin
```

Run migrations against that database before starting locally; only Fly's release command runs them automatically. `.env` files are excluded from Git and the Docker build context.

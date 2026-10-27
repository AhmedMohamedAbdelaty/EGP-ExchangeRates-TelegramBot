# Production operations

This runbook prepares a separate Cloudflare Worker, `egp-exchange-production`, for `@EGP_Exchange_Bot`. The configuration and commands below do not establish that the Worker has been deployed, that Telegram points to it, or that historical production data has been recovered. Verify each state before acting.

The test Worker, `egp-exchange-cloudflare-test`, and its bot, secrets, webhook, and data are separate. Do not reuse its credentials or import its data into production. A GitHub push can trigger an existing test build; check the test Worker's build settings before changing its connected branch.

## Prepare the target

1. Confirm the Cloudflare account, production bot identity, intended GitHub repository and revision, and production Worker's HTTPS hostname. `wrangler.production.jsonc` names the production Worker and defines SQLite-backed `CHAT_SESSIONS` and `ANALYTICS` Durable Objects. Keep the `v1` migration after deployment; use new migrations for later class lifecycle changes.
2. Install the pinned dependencies using Node.js 24.22.1, and validate locally:

   ```sh
   npm ci
   npm run cf:test
   npm run cf:check:production
   ```

   The production check is a dry run; it does not publish. Review the revision and lockfile that Cloudflare will build.
3. Configure three **runtime secrets** on the production Worker: `BOT_TOKEN` for `@EGP_Exchange_Bot`, a random `WEBHOOK_SECRET`, and an independent random `ADMIN_SECRET`. The webhook secret must be 1–256 ASCII letters, digits, `_`, or `-`. Keep secrets out of Git, build variables, URLs, terminal history, and logs. Use separate production and test credentials.
4. For the operator helper, create `~/.config/egp-exchange-bot/cloudflare-production.env` in an owner-only directory and make the file owner-only. Store the three names as `NAME=value` lines using a private editor. The helper rejects a symlink, non-regular file, or directory/file not owned by the current user or accessible to others. Do not paste credentials into commands or share the file.

## Build and deploy

For GitHub integration, restrict Cloudflare's GitHub access to the intended repository and grant only the access needed for builds. Protect the selected branch. In the **production** Worker's Builds settings, select that repository and branch, the repository root, build command `npm run cf:test`, and deploy command `npm run cf:deploy:production`. Set the build variable `NODE_VERSION=24.22.1`; runtime secrets belong in the Worker's secrets settings, not build variables. Disable preview builds until separately scoped credentials and storage are configured. Saving build settings or pushing to the selected branch can deploy; verify the selected Worker, account, branch, and revision before enabling the integration.

The root `wrangler.jsonc` belongs to the test Worker. Cloudflare may suggest changing its name to match production; do not accept that suggestion. The production deploy command explicitly selects `wrangler.production.jsonc`. Verify both Workers' build results after changes to the shared branch.

For a deliberate manual deployment, use `npm run cf:deploy:production` from the reviewed revision with the intended Cloudflare account selected. It publishes the Worker; it does not register a Telegram webhook. Confirm the deployed version and hostname in Cloudflare. Check `GET /health` on that hostname; an OK response shows availability only, not Telegram delivery or provider health.

The production helper is pinned to `https://egp-exchange-production.am0103738.workers.dev` and its `/webhook` path. Verify that this is the actual production origin before using it; do not change the test Worker's configuration to match it.

## State and cutover

Cloudflare Durable Object storage is independent of Deno KV. Availability of the former Deno Deploy Classic production KV and its backups is unknown. Do not assume test data represents production or that a browser login can recover the old database. Locate and verify an authorized production export or backup before planning a migration. If none is available, explicitly decide how to proceed without historical data.

Never overwrite existing production state. A migration requires a verified source and destination, a write pause, a private backup, and a reviewed reconciliation plan. The import endpoint rejects conflicts, and imports can partially complete; a successful response alone is not a complete migration audit. Do not use the test-only migration helper against production. Preserve both source and destination until verification and rollback planning are complete.

1. Install the same verified production token in the Worker and the local credentials file. The helper verifies the local token's bot username and tests the Worker's webhook secret, but it cannot verify the identity of the Worker's stored bot token. Confirm its identity separately before cutover. Run `python3 scripts/cloudflare_production.py status` to report the webhook as `unset`, `production`, or `unknown`, plus the pending count. An unknown target requires investigation; the helper will not replace it.
2. After the Worker, secrets, state decision, and prior host have been reviewed, run `python3 scripts/cloudflare_production.py register` to route delivery to production. It verifies the bot identity, refuses an unknown existing webhook, preserves pending updates, and reads the target back. Telegram permits one webhook per bot, so registration moves delivery from any previous target.
3. Run the status command again, check the deployed logs and pending count, and send a user-controlled test message. `python3 scripts/cloudflare_production.py dashboard` reads the protected production dashboard. Avoid logging credentials or private user data.

## Rollback and recovery

For a bad code revision, select the intended production Worker and a compatible previous version in Cloudflare's deployment history. A code rollback changes routing to that version; it does not rewind Durable Object data. Check schema and migration compatibility before rolling back, then verify health, webhook status, queue, and a test message.

To return delivery to an earlier host, first verify that host and its matching webhook secret, then decide how to reconcile writes made on Cloudflare. There is no automatic reverse export. Restore the earlier webhook through a deliberately reviewed procedure, preserve pending updates, and verify identity, target, queue, and delivery. Do not discard pending updates, run competing consumers, delete Durable Objects, or overwrite state to force a rollback. The production helper intentionally refuses to replace an unknown target and does not provide a rollback command.

Telegram delivery and SQLite commits are not atomic: a retry after a reply but before the session and deduplication record commit can send a duplicate reply. Deduplication records are kept for at least seven days and older records are pruned during later successful updates.

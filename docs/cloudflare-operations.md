# Cloudflare Workers operations

The **test Worker**, `egp-exchange-cloudflare-test`, is running at [egp-exchange-cloudflare-test.am0103738.workers.dev](https://egp-exchange-cloudflare-test.am0103738.workers.dev/health). Test data was copied from Deno KV to the Worker. Real Telegram delivery and provider-backed test replies were verified. Cloudflare is configured to build the `codex/cloudflare-test` branch of the linked GitHub repository; check build history for deployment status. The separate production bot's current state was not checked. Confirm the Cloudflare account, bot identity, target branch, and endpoint before making changes.

The Worker uses SQLite-backed Durable Objects: `CHAT_SESSIONS` stores each chat's session and update deduplication records, while `ANALYTICS` stores counters. Cloudflare storage is separate from Deno KV. The `v1` migration creates both classes; preserve it after deployment and use new migrations for later class lifecycle changes. Neither deployment nor a code rollback transfers or rewinds data.

Deduplication records are kept for at least seven days; older records are pruned during later successful updates. Telegram replies and SQLite commits cannot be atomic: if a handler fails after sending a reply but before committing the session and update marker, a retry can send a duplicate reply.

## Local build and test

Use Node.js 24.22.1 and the pinned npm dependencies (npm 12.2.1 requires Node 22.22.2+, 24.15.0+, or 26+). From the repository root:

```sh
npm ci
npm run cf:check
npm run cf:test
```

The dry run builds without publishing. For requests that need secrets, create an ignored `.dev.vars` file with `BOT_TOKEN`, `WEBHOOK_SECRET`, and `ADMIN_SECRET` using a separate test bot and random secrets, then run `npm run cf:dev`. `WEBHOOK_SECRET` must contain 1–256 ASCII letters, digits, `_`, or `-`. Keep this file private. Wrangler uses local Durable Object state under `.wrangler/`; it is not the deployed state. Stop local development before changing or clearing its state. `GET /health` only checks availability; it does not prove Telegram delivery or price-provider health.

## GitHub integration and deployment

1. In Cloudflare Workers & Pages, select the existing test Worker and configure its runtime secrets through **Settings > Variables and Secrets**. Use the exact names above and the test bot token. Do not put secrets in Git, build variables, URLs, command history, or logs. Verify the bot identity and exact webhook target with `python3 scripts/cloudflare_test.py status` before any cutover.
2. Connect the intended GitHub repository under **Settings > Builds**. The requested repository is `AhmedMohamedAbdelaty/EGP-ExchangeRates-TelegramBot`, and its test deployment branch is `codex/cloudflare-test`. The original repair checkout has a different `origin`: `AhmedMohamedAbdelaty/TelegramBot-deno`. Verify that the intended revision and lockfile are present on the connected branch before enabling builds. Restrict the GitHub integration to the intended repository. Protect the production branch in GitHub. Each push to this branch deploys automatically; connecting or saving a build configuration may trigger a deployment. Disable preview builds until separately scoped preview credentials and storage are configured.
3. Set the project root to the repository root, build command to `npm run cf:test`, and deploy command to `npx wrangler deploy`. Workers Builds installs dependencies automatically. Set build variable `NODE_VERSION=24.22.1`; `packageManager` pins npm. Build variables are separate from runtime secrets. Check the Worker name and account before saving.
4. Review the deployment and its logs. Confirm `GET /health`, the active version, and the actual HTTPS hostname. The Worker does not register the Telegram webhook at startup. Only after testing and any data migration, deliberately register the test bot's `/webhook` URL with the same webhook secret. Run `python3 scripts/cloudflare_test.py register` only when ready to move delivery, then verify the target and pending updates with `python3 scripts/cloudflare_test.py status` and delivery with a user-controlled test message. Never discard queued updates to make the status look clean.

The Cloudflare helper reads `BOT_TOKEN`, `WEBHOOK_SECRET`, and `ADMIN_SECRET` from the owner-only `~/.config/egp-exchange-bot/cloudflare-test.env` file; set `CLOUDFLARE_TEST_ENV` to use another private file. Status checks the full webhook URL, including `/webhook`, and reports whether it matches the Cloudflare or previous Deno test target without printing unknown URLs. `python3 scripts/cloudflare_test.py dashboard` displays the protected dashboard. Registration verifies the bot identity, refuses an unknown target, and preserves pending updates.

The existing `scripts/register_test_webhook.py` targets the Deno test endpoint and refuses a different configured webhook. Do not use it unchanged for a Cloudflare cutover. Telegram allows only one webhook per bot, so registration moves delivery away from the previous host.

### Rotate the test token

Revoke the test bot token through BotFather, then update the encrypted `BOT_TOKEN` runtime secret in the test Worker's Cloudflare settings. Update the owner-only test credentials file with the new token as well; never put it in Git. Telegram may clear the webhook when a token is revoked, so run `python3 scripts/cloudflare_test.py register` and then `python3 scripts/cloudflare_test.py status`. Confirm a reply after the change. The separate production bot requires its own credentials and deployment plan.

Cloudflare references: [Git integration](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/), [build configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/), [build image](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/), and [secrets](https://developers.cloudflare.com/workers/configuration/secrets/).

## Migrating data

The test data copy was deliberate; there is no automatic Deno KV transfer or Worker export endpoint. The test migration helper `scripts/migrate_test_kv.ts` exports selected test data to a private file and imports it to the test Worker. It resets `isOperationInProgress` to `false` in exported sessions to avoid resuming stale operations. It does not modify the source session. Do not assume historical production data is available.

For another migration, first obtain and independently verify a protected export from the actual source database. Stop source writes during the final copy, keep the export private, and retain it until verification and rollback are complete. Import before switching the webhook, while the target is empty and not receiving updates. The import endpoint accepts one JSON object per `POST /admin/import` with `Authorization: Bearer <ADMIN_SECRET>` over HTTPS. These examples use fictional values:

```json
{"kind":"session","chatId":"123456","session":{"favoriteCurrencies":["USD"]}}
```

```json
{"kind":"counter","counter":"daily","key":"2026-10-27","value":42}
```

For a command counter use `"counter":"command"` and the command as `key`. Session fields are `fromCurrency`, `toCurrency`, `amountToConvert`, `favoriteCurrencies`, and `isOperationInProgress`. Preserve source values and types, except for the helper's deliberate reset above. Chat IDs are canonical decimal strings. Counters must be nonnegative safe integers. An identical import is accepted unchanged; a different value or an already touched chat returns 409. Do not retry a conflict with an overwrite: investigate the source, target and cutover order. Import does not transfer old update-deduplication records. Compare imported favorites and counters against the export, then perform a controlled test before cutover. A `200` response alone is not a complete migration audit.

## Rollback

For a bad Worker revision, inspect the deployment history and use the dashboard or `npx wrangler rollback <VERSION_ID>` only after selecting the intended account and Worker. Rollback immediately routes traffic to the selected version; it does not revert Durable Object data, and class lifecycle changes can prevent rollback. Verify schema compatibility before proceeding. See [Cloudflare rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/).

To return Telegram delivery to the prior host, first verify that host is healthy and determine how to reconcile changes written to Cloudflare since cutover. There is no automated reverse export. Only then deliberately restore the prior webhook with its matching secret and verify identity, URL, queue, and a test message. Avoid two competing pollers or writes to both stores during reconciliation.

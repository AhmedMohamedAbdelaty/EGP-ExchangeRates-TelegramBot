# EGP Exchange Rates Telegram Bot

An Arabic-language Telegram bot for Egyptian currency, gold, and fuel prices. It reads ForexFy and Sarf Today, keeps favorite currencies, and supports amount conversion using the provider's labeled quotes.

The repaired **test bot** is [@randombot_test_bot](https://t.me/randombot_test_bot). We did not use or change the separate production bot, `@EGP_Exchange_Bot`; its current webhook and historical data were not checked. Its former Deno Deploy Classic host is no longer available.

The test Worker is running at [egp-exchange-cloudflare-test.am0103738.workers.dev](https://egp-exchange-cloudflare-test.am0103738.workers.dev/health), and test data has been copied from Deno KV into its Durable Objects. Telegram delivery and provider-backed replies have been verified. Cloudflare is configured to build the `codex/cloudflare-test` branch of the linked GitHub repository; check the build history for deployment status.

## Use the bot

Start with `/start` and use the menu. `/help` lists the commands. Use `/setfav USD` to toggle a favorite, `/myfavs` to list favorites, and the favorite-rates button to see their quotes. Enter `150.75 USD`, `100 EGP`, or `100 USD to EUR` to convert.

Conversion shows estimates using the data provider's **Buy** and **Sell** labels. These are indicative calculations, not confirmed transaction prices. A missing quote is reported as unavailable.

## Local setup

1. Install Deno 2.9.3 or later, Node.js 24.22.1, and a separate Telegram test bot token. Run `npm ci` to install the pinned dependencies.
2. Create `.env` in the project directory with `BOT_TOKEN=<test token>`. `deno task dev` switches that bot to polling by removing its webhook, so use it only with a token intended for local testing.
3. Run `deno task dev` and send `/start` to the test bot. Stop the process with Ctrl+C.

For the webhook server, also set `WEBHOOK_SECRET` to a random 1–256 character string containing only letters, numbers, `_`, and `-`, then run `deno task start`. The server listens on `PORT`, defaulting to 8000. It does not register or change a webhook at startup.

`GET /health` reports HTTP server availability. Telegram updates go to `POST /webhook` and require the matching `X-Telegram-Bot-Api-Secret-Token` header. The old public message relay has been removed. For the local Deno server, set `ADMIN_DASHBOARD_TOKEN` to enable `GET /admin`; access requires `Authorization: Bearer <token>`. The Cloudflare Worker uses `ADMIN_SECRET` instead.

## Check and deploy

The [Cloudflare operations guide](docs/cloudflare-operations.md) covers local Worker tests, migration, deployment, and rollback. The migration helper resets `isOperationInProgress` to `false` in exported sessions. The Worker retains update deduplication records for at least seven days, pruning older records during later successful updates. A failure after a reply is sent but before the session and update marker commit can cause a duplicate reply on retry.

The [migration guide](docs/migration-cloudflare.md) describes how to copy a dedicated Deno KV test database and verify the result.

# Migrate the test bot's Deno KV data

This procedure copies every session and both analytics counter groups from a **dedicated test-bot KV database** to the test Cloudflare Worker. It does not change Deno data, deploy a Worker, or change a Telegram webhook. Do not use it if the source database is shared with production or another bot: session keys do not identify which bot owns them.

The export contains chat IDs and favorites. Treat it as private user data. It contains only `sessions`, `analytics/daily_interactions`, and `analytics/command_usage`; other KV keys are not exported. The old bot kept conversations in memory, so active conversations cannot be migrated. The export resets `isOperationInProgress` to false to avoid locking a migrated chat; the source value is untouched.

## Before starting

1. In Deno Deploy, verify the exact app, environment/timeline, and database are dedicated to the test bot. Identify its KV Connect URL in that database's dashboard. A signed-in browser session is not a `DENO_KV_ACCESS_TOKEN`; a personal or organization access token with access to that specific database is required. This project has not verified a live connection to that database.
2. Deno's [current KV reference](https://docs.deno.com/deploy/reference/deno_kv/) describes an external `https://api.deno.com/v2/databases/<id>/connect` URL and access token. Its [Node KV page](https://docs.deno.com/deploy/kv/node/) says new Deploy external access is unavailable and describes the older Classic URL. Check the actual dashboard and connection capability before proceeding; do not assume the old Classic database is still accessible. If no authorized connection or existing backup is available, stop: this procedure cannot recover it from a browser login alone.
3. Verify the destination Worker URL and its `ADMIN_SECRET` belong to the Cloudflare **test** Worker. Do not use the production Worker or token. The import endpoint is `/admin/import` and uses the Worker's separate admin secret, not a Telegram token.
4. Stop updates to both test deployments for the export, import, and verification. Coordinate that pause separately; this script does not change routing. KV listing and multi-record imports are not atomic snapshots, and updates during the migration can cause conflicts or missed data. Keep the old deployment and database intact until verification and any routing decision are complete.

## Export and import

Run from this repository in a private terminal. Use a private directory and never paste credentials into a command or commit the export. The source URL is not the app's public URL; copy the KV Connect URL for the verified test database.

```sh
umask 077
migration_dir=$(mktemp -d)
read -rs DENO_KV_ACCESS_TOKEN
export DENO_KV_ACCESS_TOKEN
# Substitute the verified URL; alternatively use an existing local KV database file.
source_kv='https://api.deno.com/v2/databases/DATABASE_ID/connect'
deno run --unstable-kv --allow-read --allow-write --allow-env=DENO_KV_ACCESS_TOKEN --allow-net \
  scripts/migrate_test_kv.ts export "$source_kv" "$migration_dir/export.json" --all-test-sessions
unset DENO_KV_ACCESS_TOKEN
```

The script creates the export with owner-only permissions and refuses an existing file. It reads all session keys, checks their shape, and rejects unsupported values or counters above JavaScript's safe integer range rather than silently dropping them. It prints a record count, not IDs or values. Confirm the count is plausible for the test database before proceeding; zero records is not proof that the correct database was selected. If export fails, remove any incomplete export in the private directory before retrying with a new filename. The source is not deleted.

```sh
read -rs MIGRATION_ADMIN_SECRET
export MIGRATION_ADMIN_SECRET
# Substitute the verified test Worker's HTTPS origin, with no path.
export MIGRATION_TEST_WORKER_URL='https://YOUR-TEST-WORKER.workers.dev/'
deno run --allow-read="$migration_dir/export.json" --allow-env=MIGRATION_ADMIN_SECRET,MIGRATION_TEST_WORKER_URL --allow-sys=uid --allow-net \
  scripts/migrate_test_kv.ts import "$migration_dir/export.json"
```

The importer validates the complete bundle before sending anything, rejects redirects and non-HTTPS endpoints, and sends records individually. Existing identical records are unchanged; conflicting session or counter values produce HTTP 409 and stop the import. A failed or interrupted run may already have imported earlier records. Keep both bots paused, resolve the destination conflict deliberately, and rerun the same bundle: identical records will be skipped. The importer never overwrites a conflict.

## Verify and roll back

1. With updates still paused, repeat the **same import command**. Every record should report unchanged and none imported. This replay can create a record that was missing, so a nonzero imported count means verification was not complete; repeat until all are unchanged. A conflict means the destination differs or has been used: stop and investigate. This checks each exported record against the destination; it cannot detect additional destination records and is not a read-only audit. An empty export is rejected because it cannot verify either endpoint.
2. In the authenticated test dashboard, check aggregate daily and command counters. After an independently authorized switch to the test Worker, test `/myfavs` for representative test chats. This checks actual bot behavior; it does not prove every chat's behavior. Retain the private bundle until the test is accepted and rollback is no longer needed.
3. For rollback, stop test traffic and restore the previous test routing through the normal authorized webhook procedure. The old KV is preserved, but changes made only after switching to Cloudflare are not automatically copied back. Imports are not transactionally rolled back; the destination has no bulk undo. Do not delete a Durable Object or overwrite conflicting records without separately reviewing the effects. Once no longer needed, remove the private export and directory, and unset `MIGRATION_ADMIN_SECRET` and `MIGRATION_TEST_WORKER_URL` from the shell.

Local validation: `deno test --unstable-kv --allow-run --allow-read --allow-write --allow-net=127.0.0.1 scripts/migrate_test_kv_test.ts`. This exercises an in-memory and local KV, a mocked import endpoint, and the import command's permissions against a local listener; it does not verify managed-Deno credentials or a deployed Cloudflare Worker.

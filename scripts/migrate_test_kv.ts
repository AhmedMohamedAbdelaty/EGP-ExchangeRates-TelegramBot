/** Copy sessions and counters from the verified dedicated test KV. Never mutates the source KV. */
type Item =
  | { kind: "session"; chatId: string; session: Record<string, unknown> }
  | { kind: "counter"; counter: "daily" | "command"; key: string; value: number };

type Bundle = { version: 1; items: Item[] };
const sessionFields = new Set([
  "fromCurrency",
  "toCurrency",
  "amountToConvert",
  "favoriteCurrencies",
  "isOperationInProgress",
]);

function fail(): never {
  throw new Error("Invalid migration input or unavailable resource");
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}
function chatId(value: unknown): value is string {
  return typeof value === "string" && /^-?(0|[1-9]\d*)$/.test(value) &&
    Number.isSafeInteger(Number(value)) && String(Number(value)) === value;
}
function validSession(value: unknown): value is Record<string, unknown> {
  if (!object(value) || Object.keys(value).some((key) => !sessionFields.has(key))) return false;
  return ["fromCurrency", "toCurrency"].every((key) =>
    value[key] === undefined || (typeof value[key] === "string" && value[key].length <= 100)
  ) &&
    (value.amountToConvert === undefined ||
      (typeof value.amountToConvert === "number" && Number.isFinite(value.amountToConvert))) &&
    (value.isOperationInProgress === undefined ||
      typeof value.isOperationInProgress === "boolean") &&
    (value.favoriteCurrencies === undefined ||
      (Array.isArray(value.favoriteCurrencies) && value.favoriteCurrencies.length <= 100 &&
        value.favoriteCurrencies.every((item) => typeof item === "string" && item.length <= 100)));
}
function validCounter(counter: unknown, key: unknown, value: unknown): boolean {
  return (counter === "daily" || counter === "command") && typeof key === "string" &&
    (counter === "daily" ? /^\d{4}-\d{2}-\d{2}$/.test(key) : /^\w{1,4096}$/.test(key)) &&
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function validateBundle(input: unknown): Bundle {
  if (
    !object(input) || input.version !== 1 || !Array.isArray(input.items) ||
    Object.keys(input).sort().join(",") !== "items,version"
  ) fail();
  const seen = new Set<string>();
  if (input.items.length === 0) fail();
  for (const item of input.items) {
    if (!object(item)) fail();
    let identity: string;
    if (
      item.kind === "session" && Object.keys(item).sort().join(",") === "chatId,kind,session" &&
      chatId(item.chatId) && validSession(item.session) &&
      item.session.isOperationInProgress !== true
    ) {
      identity = `s:${item.chatId}`;
    } else if (
      item.kind === "counter" && Object.keys(item).sort().join(",") === "counter,key,kind,value" &&
      validCounter(item.counter, item.key, item.value)
    ) {
      identity = `c:${item.counter}:${item.key}`;
    } else fail();
    if (seen.has(identity)) fail();
    seen.add(identity);
  }
  return input as Bundle;
}

async function privateFile(path: string): Promise<string> {
  const stat = await Deno.lstat(path);
  if (
    !stat.isFile || stat.isSymlink || stat.uid !== Deno.uid() || stat.mode === null ||
    (stat.mode & 0o077) !== 0
  ) fail();
  return await Deno.readTextFile(path);
}

export async function collect(kv: Deno.Kv): Promise<Bundle> {
  const items: Item[] = [];
  for await (const entry of kv.list({ prefix: ["sessions"] }, { consistency: "strong" })) {
    if (entry.key.length !== 2 || !chatId(entry.key[1]) || !validSession(entry.value)) fail();
    // Conversations are not persisted by the old bot; a stale busy flag would block the new bot.
    items.push({
      kind: "session",
      chatId: entry.key[1],
      session: { ...entry.value, isOperationInProgress: false },
    });
  }
  for (
    const [prefix, counter] of [["daily_interactions", "daily"], [
      "command_usage",
      "command",
    ]] as const
  ) {
    for await (
      const entry of kv.list({ prefix: ["analytics", prefix] }, { consistency: "strong" })
    ) {
      if (
        entry.key.length !== 3 || typeof entry.key[2] !== "string" ||
        !(entry.value instanceof Deno.KvU64)
      ) fail();
      const count = entry.value.value;
      if (count > BigInt(Number.MAX_SAFE_INTEGER)) fail();
      const value = Number(count);
      if (!validCounter(counter, entry.key[2], value)) fail();
      items.push({ kind: "counter", counter, key: entry.key[2], value });
    }
  }
  return validateBundle({ version: 1, items });
}

export async function send(
  bundle: unknown,
  base: string,
  secret: string,
  fetcher: typeof fetch = fetch,
): Promise<{ imported: number; unchanged: number }> {
  const checked = validateBundle(bundle);
  const url = new URL(base);
  if (
    url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" ||
    url.search || url.hash || !secret || /[\r\n]/.test(secret)
  ) fail();
  let imported = 0, unchanged = 0;
  for (const item of checked.items) {
    const response = await fetcher(new URL("/admin/import", url), {
      method: "POST",
      redirect: "error",
      headers: { "Authorization": `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify(item),
    });
    if (response.status === 409) {
      throw new Error(
        "Import stopped: destination has conflicting state; earlier items may have been imported",
      );
    }
    if (response.status !== 200) {
      throw new Error(
        "Import stopped: destination rejected a request; earlier items may have been imported",
      );
    }
    const result = await response.json().catch(() => fail());
    if (!object(result) || !["imported", "unchanged"].includes(result.status as string)) fail();
    if (result.status === "imported") imported++;
    else unchanged++;
  }
  return { imported, unchanged };
}

async function main(args: string[]) {
  if (args[0] === "export" && args.length === 4 && args[3] === "--all-test-sessions") {
    const [, source, output] = args;
    if (source.startsWith("https://")) {
      const url = new URL(source);
      if (
        url.hostname !== "api.deno.com" || url.username || url.password || url.search || url.hash ||
        !/^\/(?:v2\/)?databases\/[^/]+\/connect$/.test(url.pathname)
      ) fail();
      if (!Deno.env.get("DENO_KV_ACCESS_TOKEN")) fail();
    } else {
      // Avoid creating an empty local database when the operator mistypes a path.
      const stat = await Deno.lstat(source);
      if (!stat.isFile || stat.isSymlink) fail();
    }
    const kv = await Deno.openKv(source);
    try {
      const bundle = await collect(kv);
      const file = await Deno.open(output, { createNew: true, write: true, mode: 0o600 });
      try {
        const bytes = new TextEncoder().encode(JSON.stringify(bundle));
        let offset = 0;
        while (offset < bytes.length) {
          const written = await file.write(bytes.subarray(offset));
          if (written === 0) fail();
          offset += written;
        }
      } finally {
        file.close();
      }
      console.log(`Exported ${bundle.items.length} records to a new private file.`);
    } finally {
      kv.close();
    }
  } else if (args[0] === "import" && args.length === 2) {
    const secret = Deno.env.get("MIGRATION_ADMIN_SECRET") ?? "";
    const url = Deno.env.get("MIGRATION_TEST_WORKER_URL") ?? "";
    const bundle = JSON.parse(await privateFile(args[1]));
    let result: { imported: number; unchanged: number };
    try {
      result = await send(bundle, url, secret);
    } catch {
      throw new Error(
        "Import stopped: a request failed or conflicted; earlier items may have been imported",
      );
    }
    console.log(`Import complete: ${result.imported} imported, ${result.unchanged} unchanged.`);
  } else {
    throw new Error(
      "Usage: migrate_test_kv.ts export <source-kv-url-or-file> <new-private-output> --all-test-sessions | import <private-output>",
    );
  }
}

if (import.meta.main) {
  try {
    await main(Deno.args);
  } catch (error) {
    // Deliberately omit exception details: URLs and file contents may contain sensitive data.
    const message = error instanceof Error &&
        (error.message.startsWith("Import stopped:") || error.message.startsWith("Usage:"))
      ? error.message
      : "Migration failed; check access, input format and destination without exposing sensitive values.";
    console.error(message);
    Deno.exit(1);
  }
}

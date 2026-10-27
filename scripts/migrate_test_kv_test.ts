import { collect, send } from "./migrate_test_kv.ts";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
async function rejects(fn: () => Promise<unknown>) {
  let rejected = false;
  try {
    await fn();
  } catch {
    rejected = true;
  }
  assert(rejected, "expected rejection");
}

Deno.test("export preserves every session and supported analytics without modifying KV", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    await kv.set(["sessions", "42"], { favoriteCurrencies: ["USD"], isOperationInProgress: true });
    await kv.set(["sessions", "43"], { favoriteCurrencies: ["EUR"] });
    await kv.set(["secrets", "token"], "never export");
    await kv.set(["analytics", "daily_interactions", "2026-10-27"], new Deno.KvU64(3n));
    await kv.set(["analytics", "command_usage", "start"], new Deno.KvU64(2n));
    await kv.set(["analytics", "command_usage", "a".repeat(65)], new Deno.KvU64(1n));
    const result = await collect(kv);
    assert(result.items.length === 5, "unexpected export count");
    assert(JSON.stringify(result).includes('"favoriteCurrencies":["USD"]'), "favorites lost");
    assert(
      JSON.stringify(result).includes('"favoriteCurrencies":["EUR"]') &&
        !JSON.stringify(result).includes("never export"),
      "session missing or unrelated data leaked",
    );
    assert(
      result.items[0].kind === "session" && result.items[0].session.isOperationInProgress === false,
      "stale operation not reset",
    );
    assert(
      (await kv.get<{ isOperationInProgress: boolean }>(["sessions", "42"])).value
        ?.isOperationInProgress === true,
      "source modified",
    );
  } finally {
    kv.close();
  }
});

Deno.test("invalid IDs, unexpected keys, and unsafe counters fail closed", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    await rejects(() => collect(kv));
    await kv.set(["sessions", "01"], {});
    await rejects(() => collect(kv));
    await kv.delete(["sessions", "01"]);
    await kv.set(["sessions", "42"], { unexpected: "private" });
    await rejects(() => collect(kv));
    await kv.delete(["sessions", "42"]);
    await kv.set(
      ["analytics", "command_usage", "start"],
      new Deno.KvU64(BigInt(Number.MAX_SAFE_INTEGER) + 1n),
    );
    await rejects(() => collect(kv));
  } finally {
    kv.close();
  }
});

Deno.test("import validates all records first, rejects redirects and stops at conflict", async () => {
  const first = {
    kind: "session",
    chatId: "42",
    session: { favoriteCurrencies: ["USD"], isOperationInProgress: false },
  };
  const second = { kind: "counter", counter: "command", key: "start", value: 2 };
  const requests: RequestInit[] = [];
  const fetcher: typeof fetch = (_url, init) => {
    requests.push(init!);
    return Promise.resolve(
      Response.json({ status: requests.length === 1 ? "imported" : "unchanged" }),
    );
  };
  const result = await send(
    { version: 1, items: [first, second] },
    "https://test.example/",
    "secret",
    fetcher,
  );
  assert(
    result.imported === 1 && result.unchanged === 1 &&
      requests.every((r) => r.redirect === "error"),
    "import result wrong",
  );
  await rejects(() =>
    send(
      { version: 1, items: [first, { ...second, value: -1 }] },
      "https://test.example/",
      "secret",
      fetcher,
    )
  );
  assert(requests.length === 2, "invalid bundle made a request");
  let calls = 0;
  await rejects(() =>
    send({ version: 1, items: [first, second] }, "https://test.example/", "secret", () => {
      calls++;
      return Promise.resolve(new Response(null, { status: 409 }));
    })
  );
  assert(calls === 1, "continued after conflict");
  await rejects(() =>
    send({ version: 1, items: [first] }, "http://test.example/", "secret", fetcher)
  );
  await rejects(() =>
    send({ version: 1, items: [first, first] }, "https://test.example/", "secret", fetcher)
  );
});

Deno.test("CLI creates an owner-only export and refuses to overwrite it", async () => {
  const dir = await Deno.makeTempDir();
  const source = `${dir}/source.db`, output = `${dir}/export.json`;
  const kv = await Deno.openKv(source);
  try {
    await kv.set(["sessions", "42"], { favoriteCurrencies: ["USD"] });
  } finally {
    kv.close();
  }
  try {
    const run = () =>
      new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "--unstable-kv",
          `--allow-read=${dir}`,
          `--allow-write=${dir}`,
          "scripts/migrate_test_kv.ts",
          "export",
          source,
          output,
          "--all-test-sessions",
        ],
        stdout: "piped",
        stderr: "piped",
      }).output();
    const first = await run();
    assert(first.success, "export command failed");
    const stat = await Deno.lstat(output);
    assert(
      stat.isFile && stat.mode !== null && (stat.mode & 0o077) === 0,
      "export permissions too broad",
    );
    const before = await Deno.readTextFile(output);
    const second = await run();
    assert(!second.success && await Deno.readTextFile(output) === before, "export overwritten");
    assert(
      !new TextDecoder().decode(first.stdout).includes("42") &&
        !new TextDecoder().decode(first.stdout).includes("USD"),
      "sensitive session printed",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("documented import permissions pass ownership checks and reach the destination", async () => {
  const dir = await Deno.makeTempDir();
  const bundle = `${dir}/export.json`;
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  try {
    await Deno.writeTextFile(
      bundle,
      JSON.stringify({
        version: 1,
        items: [{ kind: "session", chatId: "42", session: { favoriteCurrencies: ["USD"] } }],
      }),
      { mode: 0o600 },
    );
    const port = (listener.addr as Deno.NetAddr).port;
    const command = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        `--allow-read=${bundle}`,
        "--allow-env=MIGRATION_ADMIN_SECRET,MIGRATION_TEST_WORKER_URL",
        "--allow-sys=uid",
        "--allow-net",
        "scripts/migrate_test_kv.ts",
        "import",
        bundle,
      ],
      env: {
        MIGRATION_ADMIN_SECRET: "test-only-secret",
        MIGRATION_TEST_WORKER_URL: `https://127.0.0.1:${port}/`,
      },
      stdout: "piped",
      stderr: "piped",
    });
    const child = command.spawn();
    const completed = child.output();
    // No TLS server is needed: accepting the connection proves the CLI passed
    // the private-file checks and reached fetch with the documented permissions.
    const first = await Promise.race([
      listener.accept().then((connection) => ({ connection })),
      completed.then(() => ({ connection: null })),
    ]);
    assert(first.connection !== null, "import exited before contacting the local destination");
    first.connection.close();
    const result = await completed;
    assert(!result.success, "non-TLS listener unexpectedly accepted import");
    assert(
      new TextDecoder().decode(result.stderr).includes("Import stopped:"),
      "unexpected import failure",
    );
  } finally {
    listener.close();
    await Deno.remove(dir, { recursive: true });
  }
});

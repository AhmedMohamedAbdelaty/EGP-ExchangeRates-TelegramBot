import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

test("authenticated Worker serializes chat state, deduplicates and protects imports", async () => {
  const bundle = mkdtempSync(join(tmpdir(), "telegram-worker-test-"));
  let mf;
  try {
    execFileSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "deploy", "--dry-run", "--outdir", bundle], { stdio: "pipe", env: { ...process.env, WRANGLER_SEND_METRICS: "false" } });
    const replies = [];
    let failNextSend = false;
    let answers = 0;
    let releaseFirst;
    let sawFirst;
    const blocked = new Promise((resolve) => { releaseFirst = resolve; });
    const firstStarted = new Promise((resolve) => { sawFirst = resolve; });
    mf = new Miniflare(convertV4MiniflareOptions({
      modules: true,
      modulesRoot: bundle,
      rootPath: bundle,
      scriptPath: join(bundle, "worker.js"),
      compatibilityDate: "2025-04-01",
      compatibilityFlags: ["nodejs_compat"],
      bindings: { BOT_TOKEN: "12345:fake", WEBHOOK_SECRET: "webhook-secret", ADMIN_SECRET: "admin-secret" },
      durableObjects: { CHAT_SESSIONS: { className: "ChatSession", useSQLite: true }, ANALYTICS: { className: "AnalyticsStore", useSQLite: true } },
      outboundService: async (request) => {
        const method = new URL(request.url).pathname.split("/").at(-1);
        if (method === "getMe") return Response.json({ ok: true, result: { id: 12345, is_bot: true, first_name: "Test", username: "test_bot" } });
        if (method === "answerCallbackQuery") { answers++; return Response.json({ ok: true, result: true }); }
        if (method === "sendChatAction") return Response.json({ ok: true, result: true });
        assert.equal(method, "sendMessage");
        const body = await request.json();
        if (failNextSend) { failNextSend = false; return Response.json({ ok: false, error_code: 500, description: "temporary" }); }
        replies.push(body.text);
        if (body.text.includes("Added USD")) { sawFirst(); await blocked; }
        return Response.json({ ok: true, result: { message_id: replies.length, date: 1, chat: { id: body.chat_id, type: "private" }, text: body.text } });
      },
    }));
    const request = (path, options = {}) => mf.dispatchFetch(`http://local${path}`, options);
    const webhook = (update, secret = "webhook-secret") => request("/webhook", { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": secret }, body: JSON.stringify(update) });
    const update = (id, text, chat = 123) => ({ update_id: id, message: { message_id: id, date: 1, chat: { id: chat, type: "private" }, from: { id: chat, is_bot: false, first_name: "Test" }, text, entities: [{ type: "bot_command", offset: 0, length: text.split(" ")[0].length }] } });
    const importItem = (item) => request("/admin/import", { method: "POST", headers: { Authorization: "Bearer admin-secret" }, body: JSON.stringify(item) });

    assert.equal((await request("/health")).status, 200);
    assert.equal((await webhook(update(1, "/setfav USD"), "wrong")).status, 401);
    assert.equal((await request("/admin")).status, 401);
    assert.equal((await request("/sendMessage", { method: "POST" })).status, 404);
    assert.equal((await importItem({ kind: "session", chatId: "777", session: { favoriteCurrencies: ["USD"] } })).status, 200);
    assert.equal((await importItem({ kind: "session", chatId: "777", session: { favoriteCurrencies: ["USD"] } })).status, 200);
    assert.equal((await importItem({ kind: "session", chatId: "777", session: { favoriteCurrencies: ["EUR"] } })).status, 409);
    assert.equal((await importItem({ kind: "session", chatId: "bad", session: {} })).status, 400);
    assert.equal((await importItem({ kind: "counter", counter: "command", key: "help", value: 2 })).status, 200);
    assert.equal((await importItem({ kind: "counter", counter: "command", key: "help", value: 3 })).status, 409);
    assert.equal((await importItem({ kind: "counter", counter: "command", key: "a".repeat(100), value: 1 })).status, 200);

    const first = webhook(update(10, "/setfav USD"));
    await firstStarted;
    // Keep the first Telegram call open until the per-chat queue rejects excess
    // work. This proves the other requests arrived during the network await.
    const queued = Array.from({ length: 64 }, () => webhook(update(11, "/setfav EUR")));
    let timeout;
    const overloaded = await Promise.race([
      Promise.any(queued.map(async (response) => {
        const status = (await response).status;
        if (status !== 503) throw new Error(`unexpected early response ${status}`);
        return true;
      })),
      new Promise((resolve) => { timeout = setTimeout(() => resolve(false), 5000); }),
    ]).finally(() => { clearTimeout(timeout); releaseFirst(); });
    assert.equal(overloaded, true, "bounded queue must reject excess work before the first update completes");
    assert.equal((await first).status, 200);
    const queuedStatuses = await Promise.all(queued.map(async (response) => (await response).status));
    assert.equal(queuedStatuses.filter((status) => status === 200).length, 63);
    assert.equal(queuedStatuses.filter((status) => status === 503).length, 1);
    assert.equal((await webhook(update(10, "/setfav USD"))).status, 200);
    assert.equal((await webhook(update(12, "/myfavs"))).status, 200);
    assert.match(replies.at(-1), /USD/);
    assert.match(replies.at(-1), /EUR/);
    assert.equal(replies.filter((text) => text.includes("Added USD")).length, 1);
    assert.equal((await importItem({ kind: "session", chatId: "123", session: {} })).status, 409);
    failNextSend = true;
    assert.equal((await webhook(update(13, "/setfav USD"))).status, 500);
    assert.equal((await webhook(update(13, "/setfav USD"))).status, 200);
    assert.match(replies.at(-1), /Removed USD/);
    const callback = { update_id: 14, callback_query: { id: "cb", from: { id: 123, is_bot: false, first_name: "Test" }, chat_instance: "1", data: "main_menu_callback", message: { message_id: 1, date: 1, chat: { id: 123, type: "private" } } } };
    assert.equal((await webhook(callback)).status, 200);
    assert.equal((await webhook(callback)).status, 200);
    assert.equal(answers, 1);
    const dashboard = await (await request("/admin", { headers: { Authorization: "Bearer admin-secret" } })).text();
    assert.match(dashboard, /setfav: 3/);
    assert.match(dashboard, /myfavs: 1/);
    assert.match(dashboard, /help: 2/);
  } finally {
    if (mf) await mf.dispose();
    rmSync(bundle, { recursive: true, force: true });
  }
});

import { Bot } from "./deps.deno.ts";
import { createRequestHandler, createTelegramWebhook } from "./server.ts";

Deno.test("webhook, health, relay and admin enforce their boundaries", async () => {
  let updates = 0;
  let dashboard = 0;
  const handler = createRequestHandler({
    webhookSecret: "secret_123",
    adminToken: "admin-secret",
    handleUpdate: () => { updates++; return new Response("update"); },
    handleAdmin: () => { dashboard++; return new Response("dashboard"); },
  });
  const request = (path: string, init?: RequestInit) => handler(new Request(`http://localhost${path}`, init));
  const status = async (path: string, init?: RequestInit) => (await request(path, init)).status;
  const check = (actual: unknown, expected: unknown) => {
    if (actual !== expected) throw new Error(`Expected ${expected}, got ${actual}`);
  };
  check(await status("/health"), 200);
  check(await status("/"), 200);
  check(await status("/send-message", { method: "POST" }), 404);
  check(await status("/webhook", { method: "POST" }), 401);
  check(await status("/webhook", { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": "wrong" } }), 401);
  check(await status("/webhook", { method: "GET", headers: { "X-Telegram-Bot-Api-Secret-Token": "secret_123" } }), 404);
  check(updates, 0);
  check(await status("/webhook", { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": "secret_123" } }), 200);
  check(updates, 1);
  check(await status("/admin"), 401);
  check(await status("/admin", { headers: { "Authorization": "Bearer wrong" } }), 401);
  check(dashboard, 0);
  check(await status("/admin", { headers: { "Authorization": "Bearer admin-secret" } }), 200);
  check(dashboard, 1);
  const disabled = createRequestHandler({ webhookSecret: "secret", handleUpdate: () => new Response() });
  check((await disabled(new Request("http://localhost/admin"))).status, 404);
});

Deno.test("webhook secret must satisfy Telegram's secret token format", () => {
  for (const secret of ["", "bad secret", "x".repeat(257)]) {
    let rejected = false;
    try { createRequestHandler({ webhookSecret: secret, handleUpdate: () => new Response() }); }
    catch { rejected = true; }
    if (!rejected) throw new Error("Invalid secret was accepted");
  }
});

Deno.test("valid Telegram updates reach the real grammY webhook adapter", async () => {
  const bot = new Bot("123:fake", { botInfo: {
    id: 123, is_bot: true, first_name: "Test", username: "test_bot",
    can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false,
    can_connect_to_business: false, has_main_web_app: false,
  } });
  let seen = 0;
  bot.use(() => { seen++; });
  const handler = createRequestHandler({ webhookSecret: "secret", handleUpdate: createTelegramWebhook(bot, "secret") });
  const response = await handler(new Request("http://localhost/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": "secret" },
    body: JSON.stringify({ update_id: 1 }),
  }));
  if (response.status !== 200 || seen !== 1) throw new Error(`Unexpected status or update count: ${response.status}, ${seen}`);
});

Deno.test("webhook waits for a slow handler beyond grammY's default timeout", async () => {
  const bot = new Bot("123:fake", { botInfo: {
    id: 123, is_bot: true, first_name: "Test", username: "test_bot",
    can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false,
    can_connect_to_business: false, has_main_web_app: false,
  } });
  let completed = false;
  bot.use(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10_050));
    completed = true;
  });
  const handler = createRequestHandler({webhookSecret: "secret", handleUpdate: createTelegramWebhook(bot, "secret")});
  const response = await handler(new Request("http://localhost/webhook", {
    method: "POST",
    headers: {"Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": "secret"},
    body: JSON.stringify({update_id: 2}),
  }));
  if (response.status !== 200 || !completed) throw new Error("Webhook returned before the update completed");
});

Deno.test("a late handler rejection after timeout does not escape", async () => {
  const bot = new Bot("123:fake", { botInfo: {
    id: 123, is_bot: true, first_name: "Test", username: "test_bot",
    can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false,
    can_connect_to_business: false, has_main_web_app: false,
  } });
  let finished = false;
  bot.use(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    finished = true;
    throw new Error("late failure");
  });
  const handler = createRequestHandler({ webhookSecret: "secret", handleUpdate: createTelegramWebhook(bot, "secret", 5) });
  const response = await handler(new Request("http://localhost/webhook", {
    method: "POST", headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": "secret" },
    body: JSON.stringify({ update_id: 3 }),
  }));
  if (response.status !== 500) throw new Error("Timeout must return a retryable failure");
  await new Promise((resolve) => setTimeout(resolve, 100));
  if (!finished) throw new Error("The delayed failure was not exercised");
});

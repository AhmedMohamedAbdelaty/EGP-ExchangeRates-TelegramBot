import { DurableObject } from "cloudflare:workers";
import { createBot, type MyContext, type SessionData } from "../bot_core";

interface Env {
  BOT_TOKEN: string;
  WEBHOOK_SECRET: string;
  ADMIN_SECRET: string;
  CHAT_SESSIONS: DurableObjectNamespace<ChatSession>;
  ANALYTICS: DurableObjectNamespace<AnalyticsStore>;
}

const MAX_BODY = 128 * 1024;
const MAX_PENDING = 64;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function matchesSecret(actual: string | null, expected: string | undefined): boolean {
  if (!expected || actual === null || actual.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return difference === 0;
}

async function readJson(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > MAX_BODY) throw new Error("body too large");
  if (!request.body) throw new Error("missing body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BODY) {
      await reader.cancel();
      throw new Error("body too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function chatId(update: Record<string, unknown>): string | undefined {
  // Match grammY's chat context, including callback queries attached to messages.
  const callback = record(update.callback_query) ? update.callback_query : undefined;
  const candidate = update.message ?? update.edited_message ?? update.channel_post ??
    update.edited_channel_post ?? callback?.message ?? update.my_chat_member ??
    update.chat_member ?? update.chat_join_request ?? update.message_reaction ??
    update.message_reaction_count ?? update.chat_boost ?? update.removed_chat_boost;
  if (!record(candidate) || !record(candidate.chat)) return undefined;
  const id = candidate.chat.id;
  return typeof id === "number" && Number.isSafeInteger(id) ? String(id) : undefined;
}

function validChatId(value: unknown): value is string {
  if (typeof value !== "string" || !/^-?(0|[1-9]\d*)$/.test(value)) return false;
  const number = Number(value);
  return Number.isSafeInteger(number) && String(number) === value;
}

function validSession(value: unknown): value is SessionData {
  if (!record(value)) return false;
  const allowed = new Set(["fromCurrency", "toCurrency", "amountToConvert", "favoriteCurrencies", "isOperationInProgress"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return false;
  for (const key of ["fromCurrency", "toCurrency"]) {
    if (value[key] !== undefined && (typeof value[key] !== "string" || value[key].length > 100)) return false;
  }
  if (value.amountToConvert !== undefined && (typeof value.amountToConvert !== "number" || !Number.isFinite(value.amountToConvert))) return false;
  if (value.isOperationInProgress !== undefined && typeof value.isOperationInProgress !== "boolean") return false;
  if (value.favoriteCurrencies !== undefined && (!Array.isArray(value.favoriteCurrencies) || value.favoriteCurrencies.length > 100 || value.favoriteCurrencies.some((item) => typeof item !== "string" || item.length > 100))) return false;
  return true;
}

function canonicalSession(value: SessionData): string {
  return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))));
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

const app = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (request.method === "GET" && (path === "/" || path === "/health")) return new Response("OK");
    if (request.method === "POST" && path === "/webhook") {
      if (!env.WEBHOOK_SECRET || !env.BOT_TOKEN) return new Response("Service unavailable", { status: 503 });
      if (!matchesSecret(request.headers.get("X-Telegram-Bot-Api-Secret-Token"), env.WEBHOOK_SECRET)) return new Response("Unauthorized", { status: 401 });
      let update: unknown;
      try { update = await readJson(request); } catch { return new Response("Invalid request", { status: 400 }); }
      if (!record(update) || !Number.isSafeInteger(update.update_id) || (update.update_id as number) < 0) return new Response("Invalid update", { status: 400 });
      const id = chatId(update);
      if (id === undefined) {
        console.info("Ignored Telegram update without a chat");
        return new Response("OK");
      }
      try {
        const stub = env.CHAT_SESSIONS.get(env.CHAT_SESSIONS.idFromName(id));
        return await stub.fetch("https://internal/update", { method: "POST", body: JSON.stringify(update) });
      } catch {
        console.error("Update processing failed");
        return new Response("Internal Server Error", { status: 500 });
      }
    }
    if ((path === "/admin" && request.method === "GET") || (path === "/admin/import" && request.method === "POST")) {
      if (!env.ADMIN_SECRET) return new Response("Not Found", { status: 404 });
      if (!matchesSecret(request.headers.get("Authorization"), `Bearer ${env.ADMIN_SECRET}`)) return new Response("Unauthorized", { status: 401 });
      const analytics = env.ANALYTICS.get(env.ANALYTICS.idFromName("global"));
      if (path === "/admin") return analytics.fetch("https://internal/dashboard");
      let input: unknown;
      try { input = await readJson(request); } catch { return new Response("Invalid request", { status: 400 }); }
      if (!record(input)) return new Response("Invalid request", { status: 400 });
      if (input.kind === "session" && validChatId(input.chatId) && validSession(input.session)) {
        const stub = env.CHAT_SESSIONS.get(env.CHAT_SESSIONS.idFromName(input.chatId));
        return stub.fetch("https://internal/import", { method: "POST", body: canonicalSession(input.session) });
      }
      if (input.kind === "counter" && (input.counter === "daily" || input.counter === "command") && typeof input.key === "string" && (input.counter === "daily" ? /^\d{4}-\d{2}-\d{2}$/.test(input.key) : /^\w{1,4096}$/.test(input.key)) && Number.isSafeInteger(input.value) && (input.value as number) >= 0) {
        return analytics.fetch("https://internal/import", { method: "POST", body: JSON.stringify(input) });
      }
      return new Response("Invalid import", { status: 400 });
    }
    return new Response("Not Found", { status: 404 });
  },
};

export default app;

export class ChatSession extends DurableObject<Env> {
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;
  private botInfo?: ReturnType<typeof createBot>["botInfo"];

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS session (id INTEGER PRIMARY KEY CHECK(id = 1), value TEXT NOT NULL)");
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS updates (id INTEGER PRIMARY KEY, created INTEGER NOT NULL)");
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST" || !["/update", "/import"].includes(new URL(request.url).pathname)) return new Response("Not Found", { status: 404 });
    if (this.pending >= MAX_PENDING) return new Response("Busy", { status: 503, headers: { "Retry-After": "1" } });
    this.pending++;
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    try {
      await previous;
      const body = await request.json();
      if (new URL(request.url).pathname === "/import") return this.importSession(body);
      return await this.handleUpdate(body as Record<string, unknown>);
    } catch {
      console.error("Chat operation failed");
      return new Response("Internal Server Error", { status: 500 });
    } finally {
      this.pending--;
      release();
    }
  }

  private importSession(value: unknown): Response {
    if (!validSession(value)) return new Response("Invalid session", { status: 400 });
    const sql = this.ctx.storage.sql;
    const incoming = canonicalSession(value);
    const existing = sql.exec<{ value: string }>("SELECT value FROM session WHERE id = 1").toArray()[0];
    const touched = sql.exec("SELECT key FROM metadata WHERE key = 'touched'").toArray().length > 0;
    if (existing && canonicalSession(JSON.parse(existing.value)) === incoming) return json({ status: "unchanged" });
    if (existing || touched) return json({ error: "chat already has state" }, 409);
    this.ctx.storage.transactionSync(() => {
      sql.exec("INSERT INTO session (id, value) VALUES (1, ?)", incoming);
      sql.exec("INSERT INTO metadata (key, value) VALUES ('touched', '1')");
    });
    return json({ status: "imported" });
  }

  private async handleUpdate(update: Record<string, unknown>): Promise<Response> {
    const sql = this.ctx.storage.sql;
    const id = update.update_id as number;
    if (sql.exec("SELECT id FROM updates WHERE id = ?", id).toArray().length) return new Response("OK");
    const stored = sql.exec<{ value: string }>("SELECT value FROM session WHERE id = 1").toArray()[0];
    let sessionValue: SessionData = stored ? JSON.parse(stored.value) : { favoriteCurrencies: [], isOperationInProgress: false };
    const bot = createBot(this.env.BOT_TOKEN, async (ctx: MyContext, next: () => Promise<void>) => {
      ctx.session = sessionValue;
      await next();
      sessionValue = ctx.session;
    });
    if (this.botInfo) bot.botInfo = this.botInfo;
    else { await bot.init(); this.botInfo = bot.botInfo; }
    await bot.handleUpdate(update as Parameters<typeof bot.handleUpdate>[0]);
    const analytics = this.env.ANALYTICS.get(this.env.ANALYTICS.idFromName("global"));
    const analyticsResponse = await analytics.fetch("https://internal/update", { method: "POST", body: JSON.stringify(update) });
    if (!analyticsResponse.ok) throw new Error("analytics update failed");
    this.ctx.storage.transactionSync(() => {
      sql.exec("INSERT INTO session (id, value) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value", JSON.stringify(sessionValue));
      sql.exec("INSERT INTO updates (id, created) VALUES (?, ?)", id, Date.now());
      sql.exec("INSERT OR IGNORE INTO metadata (key, value) VALUES ('touched', '1')");
      sql.exec("DELETE FROM updates WHERE created < ?", Date.now() - RETENTION_MS);
    });
    return new Response("OK");
  }
}

export class AnalyticsStore extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS counters (kind TEXT NOT NULL, key TEXT NOT NULL, value INTEGER NOT NULL, PRIMARY KEY(kind, key))");
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS updates (id INTEGER PRIMARY KEY, created INTEGER NOT NULL)");
  }

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    const sql = this.ctx.storage.sql;
    if (path === "/dashboard" && request.method === "GET") {
      const rows = sql.exec<{ kind: string; key: string; value: number }>("SELECT kind, key, value FROM counters ORDER BY key").toArray();
      const escape = (value: string) => value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
      const list = (kind: string) => rows.filter((row) => row.kind === kind).map((row) => `<li>${escape(row.key)}: ${row.value}</li>`).join("");
      return new Response(`<!doctype html><html><head><meta charset="utf-8"><title>Bot Admin Dashboard</title></head><body><h1>Bot Admin Dashboard</h1><h2>Daily Interactions</h2><ul>${list("daily")}</ul><h2>Command Usage</h2><ul>${list("command")}</ul></body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
    }
    if (request.method !== "POST" || !["/update", "/import"].includes(path)) return new Response("Not Found", { status: 404 });
    const input = await request.json() as Record<string, unknown>;
    if (path === "/import") {
      const existing = sql.exec<{ value: number }>("SELECT value FROM counters WHERE kind = ? AND key = ?", input.counter as string, input.key as string).toArray()[0];
      if (existing) return existing.value === input.value ? json({ status: "unchanged" }) : json({ error: "counter already exists" }, 409);
      sql.exec("INSERT INTO counters (kind, key, value) VALUES (?, ?, ?)", input.counter as string, input.key as string, input.value as number);
      return json({ status: "imported" });
    }
    const id = input.update_id as number;
    const message = record(input.message) ? input.message : undefined;
    const command = typeof message?.text === "string" ? /^\/(\w+)/.exec(message.text)?.[1] : undefined;
    this.ctx.storage.transactionSync(() => {
      if (sql.exec("SELECT id FROM updates WHERE id = ?", id).toArray().length) return;
      const date = new Date().toISOString().slice(0, 10);
      sql.exec("INSERT INTO counters VALUES ('daily', ?, 1) ON CONFLICT(kind, key) DO UPDATE SET value = value + 1", date);
      if (command) sql.exec("INSERT INTO counters VALUES ('command', ?, 1) ON CONFLICT(kind, key) DO UPDATE SET value = value + 1", command);
      sql.exec("INSERT INTO updates (id, created) VALUES (?, ?)", id, Date.now());
      sql.exec("DELETE FROM updates WHERE created < ?", Date.now() - RETENTION_MS);
    });
    return new Response("OK");
  }
}

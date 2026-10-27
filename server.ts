import { Bot, webhookCallback, type Context } from "./deps.deno.ts";

type RequestHandler = (request: Request) => Response | Promise<Response>;

export function createTelegramWebhook<C extends Context>(bot: Bot<C>, secret: string, timeoutMs = 20_000): RequestHandler {
  // grammY's finite timeout leaves a late rejection unobserved; race its unbounded
  // callback ourselves so a timed-out update cannot crash the process later.
  const callback = webhookCallback(bot, "std/http", { secretToken: secret, timeoutMilliseconds: Infinity });
  return async (request) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Webhook timed out")), timeoutMs);
    });
    try {
      return await Promise.race([callback(request), deadline]);
    } finally {
      clearTimeout(timer);
    }
  };
}

// Compare every byte for matching-length secrets without exposing either value.
function matchesSecret(actual: string | null, expected: string): boolean {
  if (actual === null || actual.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i++) {
    difference |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return difference === 0;
}

export function createRequestHandler(options: {
  webhookSecret: string;
  handleUpdate: RequestHandler;
  adminToken?: string;
  handleAdmin?: RequestHandler;
}): RequestHandler {
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(options.webhookSecret)) {
    throw new Error("WEBHOOK_SECRET must contain 1–256 letters, digits, underscores or hyphens");
  }
  return async (request) => {
    const path = new URL(request.url).pathname;
    if (request.method === "GET" && (path === "/" || path === "/health")) {
      return new Response("OK", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    if (path === "/webhook" && request.method === "POST") {
      if (!matchesSecret(request.headers.get("X-Telegram-Bot-Api-Secret-Token"), options.webhookSecret)) {
        return new Response("Unauthorized", { status: 401 });
      }
      try {
        return await options.handleUpdate(request);
      } catch {
        console.error("Error processing update");
        return new Response("Internal Server Error", { status: 500 });
      }
    }
    if (path === "/admin" && request.method === "GET" && options.adminToken && options.handleAdmin) {
      if (!matchesSecret(request.headers.get("Authorization"), `Bearer ${options.adminToken}`)) {
        return new Response("Unauthorized", { status: 401 });
      }
      try {
        return await options.handleAdmin(request);
      } catch {
        console.error("Error serving admin dashboard");
        return new Response("Internal Server Error", { status: 500 });
      }
    }
    return new Response("Not Found", { status: 404 });
  };
}

if (import.meta.main) {
  const { config } = await import("./config.ts");
  if (!config.BOT_TOKEN) throw new Error("BOT_TOKEN is required");
  if (!config.WEBHOOK_SECRET) throw new Error("WEBHOOK_SECRET is required");
  const { bot } = await import("./bot.ts");
  const admin = config.ADMIN_DASHBOARD_TOKEN ? await import("./admin_server.ts") : undefined;
  const handler = createRequestHandler({
    webhookSecret: config.WEBHOOK_SECRET,
    handleUpdate: createTelegramWebhook(bot, config.WEBHOOK_SECRET),
    adminToken: config.ADMIN_DASHBOARD_TOKEN,
    handleAdmin: admin?.handleAdminRequest,
  });
  const configuredPort = Deno.env.get("PORT");
  if (configuredPort !== undefined) {
    if (!/^\d+$/.test(configuredPort) || Number(configuredPort) < 1 || Number(configuredPort) > 65535) {
      throw new Error("PORT must be an integer between 1 and 65535");
    }
    Deno.serve({ port: Number(configuredPort) }, handler);
  } else {
    Deno.serve(handler);
  }
}

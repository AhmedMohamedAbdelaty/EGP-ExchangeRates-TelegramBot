import { session } from "./deps.deno.ts";
import { config } from "./config.ts";
import { createBot, type MyContext, type SessionData } from "./bot_core.ts";

export type { MyContext, InnerContext, SessionData } from "./bot_core.ts";

const kv = await Deno.openKv();
const KV_ANALYTICS_DAILY_INTERACTIONS_PREFIX = ["analytics", "daily_interactions"];
const KV_ANALYTICS_COMMAND_USAGE_PREFIX = ["analytics", "command_usage"];

if (!config.BOT_TOKEN) {
    throw new Error("CRITICAL: BOT_TOKEN is not defined. Please set it in your .env file or config.");
}

// Serialize updates for a chat across instances. The session and completed update
// marker commit together, guarded by the current lease version.
export function coordinatedSession(kv: Deno.Kv, options: {
    leaseMs?: number;
    refreshMs?: number;
    waitMs?: number;
} = {}) {
    const leaseMs = options.leaseMs ?? 30_000;
    const refreshMs = options.refreshMs ?? 10_000;
    const waitMs = options.waitMs ?? 2_000;
    const initial = (): SessionData => ({ favoriteCurrencies: [], isOperationInProgress: false });

    return async (ctx: MyContext, next: () => Promise<void>) => {
        const chatId = ctx.chatId?.toString();
        if (chatId === undefined) {
            // The bot has no handlers for non-chat updates, such as closed polls.
            console.info("Ignored Telegram update without a chat");
            return;
        }

        const leaseKey = ["session_leases", chatId];
        const updateKey = ["session_updates", chatId, ctx.update.update_id];
        const sessionKey = ["sessions", chatId];
        const owner = crypto.randomUUID();
        const deadline = Date.now() + waitMs;
        let acquired = false;
        while (!acquired) {
            const lease = await kv.get<{ owner: string; expires: number }>(leaseKey);
            if (!lease.value || lease.value.expires <= Date.now()) {
                acquired = (await kv.atomic().check(lease).set(leaseKey, {
                    owner, expires: Date.now() + leaseMs,
                }).commit()).ok;
            }
            if (!acquired) {
                if (Date.now() >= deadline) throw new Error("Timed out waiting for chat session");
                await new Promise((resolve) => setTimeout(resolve, Math.min(50, deadline - Date.now())));
            }
        }

        let renewal = Promise.resolve();
        let renewalError: unknown;
        const timer = setInterval(() => {
            renewal = renewal.then(async () => {
                const lease = await kv.get<{ owner: string; expires: number }>(leaseKey);
                if (lease.value?.owner !== owner || lease.value.expires <= Date.now()) {
                    throw new Error("Chat session lease expired");
                }
                const result = await kv.atomic().check(lease).set(leaseKey, {
                    owner, expires: Date.now() + leaseMs,
                }).commit();
                if (!result.ok) throw new Error("Chat session lease lost");
            }).catch((error) => { renewalError = error; });
        }, refreshMs);

        try {
            if ((await kv.get(updateKey)).value !== null) return;
            let changed = false;
            let value: SessionData | undefined;
            const storage = {
                read: async () => (await kv.get<SessionData>(sessionKey)).value ?? undefined,
                write: (_key: string, sessionData: SessionData) => { changed = true; value = sessionData; },
                delete: () => { changed = true; value = undefined; },
            };
            await session({ initial, storage })(ctx, next);
            clearInterval(timer);
            await renewal;
            if (renewalError) throw renewalError;
            const lease = await kv.get<{ owner: string; expires: number }>(leaseKey);
            if (lease.value?.owner !== owner || lease.value.expires <= Date.now()) {
                throw new Error("Chat session lease expired");
            }
            let transaction = kv.atomic().check(lease).delete(leaseKey)
                .set(updateKey, true, { expireIn: 7 * 24 * 60 * 60 * 1000 });
            if (changed) transaction = value === undefined
                ? transaction.delete(sessionKey)
                : transaction.set(sessionKey, value);
            if (!(await transaction.commit()).ok) throw new Error("Chat session lease lost");
        } finally {
            clearInterval(timer);
            await renewal;
            const lease = await kv.get<{ owner: string; expires: number }>(leaseKey);
            if (lease.value?.owner === owner) await kv.atomic().check(lease).delete(leaseKey).commit();
        }
    };
}

// Analytics Middleware
const analyticsMiddleware = async (ctx: MyContext, next: () => Promise<void>) => {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    // Increment daily interactions
    const dailyInteractionsKey = [...KV_ANALYTICS_DAILY_INTERACTIONS_PREFIX, today];
    await kv.atomic()
        .mutate({ type: "sum", key: dailyInteractionsKey, value: new Deno.KvU64(1n) })
        .commit();

    // Increment command usage if it's a command
    if (ctx.message?.text?.startsWith("/")) {
        const commandMatch = ctx.message.text.match(/^\/(\w+)/);
        if (commandMatch && commandMatch[1]) {
            const commandName = commandMatch[1];
            const commandUsageKey = [...KV_ANALYTICS_COMMAND_USAGE_PREFIX, commandName];
            await kv.atomic()
                .mutate({ type: "sum", key: commandUsageKey, value: new Deno.KvU64(1n) })
                .commit();
        }
    }

    await next(); // Call next middleware
};

export const bot = createBot(config.BOT_TOKEN, coordinatedSession(kv), analyticsMiddleware);

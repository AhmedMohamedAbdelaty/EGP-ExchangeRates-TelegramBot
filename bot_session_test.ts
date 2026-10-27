import { Bot } from "./deps.deno.ts";
import { coordinatedSession, type MyContext } from "./bot.ts";
import { createRequestHandler, createTelegramWebhook } from "./server.ts";
import { handleSetFavoriteCommand } from "./handlers/commands.ts";

const botInfo = {
    id: 123, is_bot: true, first_name: "Test", username: "test_bot",
    can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false,
    can_connect_to_business: false, has_main_web_app: false,
} as const;
function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}
function gate() {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => { release = resolve; });
    return { promise, release };
}
function update(id: number) {
    return { update_id: id, message: {
        message_id: id, date: 0, chat: { id: 42, type: "private" as const, first_name: "Test" },
        from: { id: 42, is_bot: false, first_name: "Test" }, text: "/test",
    } };
}
function makeBot(kv: Deno.Kv, handler: (ctx: MyContext) => void | Promise<void>, options: { leaseMs?: number; refreshMs?: number; waitMs?: number } = {}) {
    const bot = new Bot<MyContext>("123:fake", { botInfo });
    bot.use(coordinatedSession(kv, options));
    bot.use(handler);
    return bot;
}
async function withKv(fn: (first: Deno.Kv, second: Deno.Kv) => Promise<void>) {
    const dir = await Deno.makeTempDir();
    const first = await Deno.openKv(`${dir}/test.db`);
    const second = await Deno.openKv(`${dir}/test.db`);
    try { await fn(first, second); }
    finally { first.close(); second.close(); await Deno.remove(dir, { recursive: true }); }
}

Deno.test("separate bot instances serialize sessions and ignore duplicate updates", async () => {
    await withKv(async (first, second) => {
        const started = gate(), resume = gate();
        let calls = 0;
        const firstBot = makeBot(first, async (ctx) => {
            calls++;
            ctx.session.favoriteCurrencies!.push("USD");
            started.release();
            await resume.promise;
        });
        const attempted = gate();
        let observedHeldLease = false;
        const observedSecond = new Proxy(second, {
            get(target, prop) {
                if (prop === "get") return async (...args: Parameters<Deno.Kv["get"]>) => {
                    const result = await target.get(...args);
                    if (args[0][0] === "session_leases" && !observedHeldLease) {
                        assert(result.value !== null, "second instance did not observe the held lease");
                        observedHeldLease = true;
                        attempted.release();
                    }
                    return result;
                };
                const value = Reflect.get(target, prop, target);
                return typeof value === "function" ? value.bind(target) : value;
            },
        });
        const secondBot = makeBot(observedSecond, (ctx) => {
            calls++;
            const favorites = ctx.session.favoriteCurrencies!;
            const index = favorites.indexOf("EUR");
            if (index < 0) favorites.push("EUR"); else favorites.splice(index, 1);
        });
        const a = firstBot.handleUpdate(update(1));
        await started.promise;
        const b = secondBot.handleUpdate(update(2));
        await attempted.promise;
        assert(calls === 1, "second handler entered while the first held the lease");
        resume.release();
        await Promise.all([a, b]);
        assert(JSON.stringify((await first.get(["sessions", "42"])).value) === JSON.stringify({ favoriteCurrencies: ["USD", "EUR"], isOperationInProgress: false }), "concurrent session updates were lost");
        await secondBot.handleUpdate(update(2));
        assert(Number(calls) === 2, "duplicate update ran its handler");
    });
});

Deno.test("expired or replaced lease fences a stalled handler and permits recovery", async () => {
    await withKv(async (first, second) => {
        const started = gate(), resume = gate();
        const stalled = makeBot(first, async (ctx) => {
            ctx.session.favoriteCurrencies!.push("USD");
            started.release();
            await resume.promise;
        }, { refreshMs: 60_000 });
        const recovered = gate(), finishRecovery = gate();
        const recovery = makeBot(second, async (ctx) => {
            ctx.session.favoriteCurrencies!.push("EUR");
            recovered.release();
            await finishRecovery.promise;
        });
        const a = stalled.handleUpdate(update(3));
        await started.promise;
        await first.set(["session_leases", "42"], { owner: "crashed", expires: 0 });
        const b = recovery.handleUpdate(update(4));
        await recovered.promise;
        resume.release();
        let rejected = false;
        try { await a; } catch { rejected = true; }
        assert(rejected, "stalled handler committed after takeover");
        assert((await second.get(["session_leases", "42"])).value !== null, "stalled cleanup deleted successor lease");
        finishRecovery.release();
        await b;
        const data = (await second.get<{ favoriteCurrencies: string[] }>(["sessions", "42"])).value;
        assert(JSON.stringify(data?.favoriteCurrencies) === '["EUR"]', "stale write replaced recovery session");
        assert((await second.get(["session_updates", "42", 3])).value === null, "failed update marked complete");
    });
});

Deno.test("renewal keeps ownership and exceptions release the lease", async () => {
    await withKv(async (first, second) => {
        const started = gate(), resume = gate();
        const holder = makeBot(first, async (ctx) => {
            ctx.session.favoriteCurrencies!.push("USD");
            started.release();
            await resume.promise;
        }, { leaseMs: 500, refreshMs: 5 });
        const a = holder.handleUpdate(update(5));
        await started.promise;
        const initialLease = await first.get(["session_leases", "42"]);
        const deadline = Date.now() + 1000;
        while ((await first.get(["session_leases", "42"])).versionstamp === initialLease.versionstamp) {
            if (Date.now() > deadline) throw new Error("lease did not renew");
            await new Promise((resolve) => setTimeout(resolve, 5));
        }
        resume.release();
        await a;
        const failure = makeBot(first, () => { throw new Error("test failure"); });
        try { await failure.handleUpdate(update(6)); } catch { /* expected */ }
        assert((await first.get(["session_leases", "42"])).value === null, "exception left lease held");
        const next = makeBot(second, (ctx) => { ctx.session.favoriteCurrencies!.push("EUR"); });
        await next.handleUpdate(update(7));
        assert(JSON.stringify((await second.get<{ favoriteCurrencies: string[] }>(["sessions", "42"])).value?.favoriteCurrencies) === '["USD","EUR"]', "later handler failed after exception");
    });
});

Deno.test("lease contention returns a retryable webhook failure", async () => {
    await withKv(async (first, second) => {
        const started = gate(), resume = gate();
        const holder = makeBot(first, async () => { started.release(); await resume.promise; });
        const a = holder.handleUpdate(update(8));
        await started.promise;
        let invoked = 0;
        const blocked = makeBot(second, () => { invoked++; });
        const handler = createRequestHandler({ webhookSecret: "secret", handleUpdate: createTelegramWebhook(blocked, "secret") });
        const request = () => new Request("http://localhost/webhook", {
            method: "POST", headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": "secret" },
            body: JSON.stringify(update(9)),
        });
        const response = await handler(request());
        assert(response.status === 500 && invoked === 0, `contention returned ${response.status} or ran the handler`);
        resume.release();
        await a;
        const retry = await handler(request());
        assert(retry.status === 200 && Number(invoked) === 1, "retry was not processed after release");
    });
});

Deno.test("replayed setfav update does not toggle a favorite twice", async () => {
    await withKv(async (first, second) => {
        let replies = 0;
        const one = makeBot(first, handleSetFavoriteCommand);
        const two = makeBot(second, handleSetFavoriteCommand);
        for (const bot of [one, two]) bot.api.config.use(() => {
            replies++;
            return Promise.resolve({ ok: true, result: true as never });
        });
        const command = update(10);
        command.message.text = "/setfav USD";
        await one.handleUpdate(command);
        await two.handleUpdate(command);
        assert(replies === 1, "duplicate favorite update replied twice");
        const data = (await second.get<{ favoriteCurrencies: string[] }>(["sessions", "42"])).value;
        assert(JSON.stringify(data?.favoriteCurrencies) === '["USD"]', "replayed command toggled the favorite off");
    });
});

Deno.test("unsupported updates without a chat are acknowledged", async () => {
    await withKv(async (first) => {
        let entered = false;
        const bot = makeBot(first, (ctx) => { entered = true; void ctx.session; });
        const handler = createRequestHandler({ webhookSecret: "secret", handleUpdate: createTelegramWebhook(bot, "secret") });
        const response = await handler(new Request("http://localhost/webhook", {
            method: "POST", headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": "secret" },
            body: JSON.stringify({ update_id: 11, poll: { id: "test", question: "test", options: [], total_voter_count: 0,
                is_closed: true, is_anonymous: true, type: "regular", allows_multiple_answers: false } }),
        }));
        assert(response.status === 200 && !entered, "non-chat update was not safely acknowledged");
    });
});

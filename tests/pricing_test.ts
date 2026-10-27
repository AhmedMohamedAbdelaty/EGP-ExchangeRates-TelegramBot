import { cheerio } from "../deps.cheerio.ts";
import { getCurrencyPrices, getFuelPrices, getGoldPrices } from "../services/api.ts";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}
function equal(actual: unknown, expected: unknown): void {
    assert(JSON.stringify(actual) === JSON.stringify(expected),
        `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
async function rejects(fn: () => Promise<unknown>): Promise<void> {
    let rejected = false;
    try { await fn(); } catch { rejected = true; }
    assert(rejected, "Expected request to fail");
}

Deno.test("pricing validates provider payloads, units, failures and cache", async () => {
    const originalFetch = globalThis.fetch;
    const fixture = await Deno.readTextFile(new URL("./fixtures/forexfy.html", import.meta.url));
    const payload = JSON.parse(cheerio(fixture)("#app").attr("data-page")!);
    const makeHtml = (value: unknown) => `<div id="app" data-page="${JSON.stringify(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;")}"></div>`;
    let forexHtml = "invalid";
    let fuelHtml = "invalid";
    let status = 200;
    let timeout = false;
    let requests = 0;
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
        requests++;
        if (timeout) return new Promise<Response>((_resolve, reject) => {
            init!.signal!.addEventListener("abort", () => reject(new Error("request timed out")));
        });
        const url = String(input);
        return Promise.resolve(new Response(url.includes("forexfy") ? forexHtml : fuelHtml, { status }));
    }) as typeof fetch;
    try {
        status = 503;
        await rejects(getCurrencyPrices);
        equal(requests, 3);
        status = 200;
        await rejects(getCurrencyPrices); // A missing embedded payload is never cached.
        forexHtml = '<div id="app" data-page="not json"></div>';
        await rejects(getGoldPrices);
        const wrongQuote = structuredClone(payload);
        wrongQuote.context.currency.code = "USD";
        forexHtml = makeHtml(wrongQuote);
        await rejects(getCurrencyPrices);
        const empty = structuredClone(payload);
        empty.data.currencies = [];
        empty.data.calculatorMetals = [];
        forexHtml = makeHtml(empty);
        await rejects(getCurrencyPrices);
        await rejects(getGoldPrices);

        const partial = structuredClone(payload);
        partial.data.currencies[0].unit = 100;
        partial.data.currencies[1].quote = "USD";
        partial.data.currencies[2].sources.bank.buy = "Infinity";
        partial.data.currencies[3].sources.market.source = "bank";
        partial.data.currencies[4].sources.bank.sell = "";
        partial.data.calculatorMetals[0].units[0].currency = "USD";
        partial.data.calculatorMetals[0].units[1].sources.local.buy = "NaN";
        forexHtml = makeHtml(partial);
        const partialCurrency = await getCurrencyPrices();
        equal(partialCurrency.bank.USD, { Buy: "0.5", Sell: "0.49" });
        assert(!partialCurrency.bank.EUR && !partialCurrency.blackMarket.EUR, "wrong quote accepted");
        assert(!partialCurrency.bank.GBP && !partialCurrency.blackMarket.SAR, "invalid source accepted");
        assert(!partialCurrency.bank.AED, "missing sell accepted");
        const partialGold = await getGoldPrices();
        assert(!partialGold.prices["24k"] && !partialGold.prices["21k"], "invalid gold accepted");
        assert(partialGold.prices["18k"]?.buy === "6800", "calculator gold/local price missing");

        // A partial response must not poison the cache.
        forexHtml = fixture;
        const complete = await getCurrencyPrices();
        for (const [index, code] of ["USD", "EUR", "GBP", "SAR", "AED", "KWD"].entries()) {
            equal(complete.bank[code], { Buy: String(50 + index), Sell: String(49 + index) });
            equal(complete.blackMarket[code], { Buy: String(51 + index), Sell: String(50 + index) });
        }
        equal(complete.lastUpdateBank, "2026-10-26");
        const beforeGold = requests;
        const gold = await getGoldPrices();
        equal(requests, beforeGold);
        const keys = ["24k", "21k", "18k", "22k", "Gold Ounce", "Gold Pound(Coin)", "14k", "12k", "9k"];
        keys.forEach((key, index) => equal(gold.prices[key], { buy: String(7000 - index * 100), sell: String(6990 - index * 100) }));
        equal(gold.lastUpdate, "2026-10-25");

        await rejects(getFuelPrices); // Currency timestamps cannot stand in for fuel timestamps.
        timeout = true;
        const beforeTimeout = Date.now();
        await rejects(getFuelPrices);
        assert(Date.now() - beforeTimeout < 10_000, "provider timeout is not bounded");
        timeout = false;
        fuelHtml = `<table class="table fuel-home-block"><tbody>
        <tr><th><span><a>Octane 80</a></span></th><td><strong>20</strong> USD</td></tr>
        <tr><th><span><a>Octane 90</a></span></th><td><strong>-1</strong> EGP</td></tr>
        </tbody></table>`;
        await rejects(getFuelPrices);
        fuelHtml = `<table class="table local-cur"><thead><tr><th>2026/5/12 16:37</th></tr></thead></table>
        <table class="table fuel-home-block"><tbody>
        <tr><th><span><a>Octane 80</a></span></th><td><strong>20.75</strong> EGP</td></tr>
        <tr><th><span><a>Octane 90</a></span></th><td><strong>22.25</strong> EGP</td></tr>
        <tr><th><span><a>Octane 95</a></span></th><td><strong>24.00</strong> EGP</td></tr>
        </tbody></table>`;
        const fuel = await getFuelPrices();
        equal(fuel.prices, { "Octane 80": "20.75 EGP", "Octane 90": "22.25 EGP", "Octane 95": "24 EGP" });
        equal(fuel.lastUpdate, "غير معروف");
    } finally {
        globalThis.fetch = originalFetch;
    }
});

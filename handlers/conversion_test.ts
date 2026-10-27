import type { MyContext } from "../bot.ts";
import { handleCurrencyConversionText } from "./conversion.ts";
import { handleBankPricesRequest } from "./currency.ts";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

Deno.test("conversion handles decimal, target, partial prices and invalid input", async () => {
    const data = {
        context: { country: { code: "EG" }, currency: { code: "EGP" } },
        data: {
            currencies: [
                { code: "USD", quote: "EGP", unit: 1, sources: {
                    bank: { source: "bank", buy: 52, sell: 50 },
                    market: { source: "market", buy: 62, sell: 60 },
                } },
                { code: "EUR", quote: "EGP", unit: 1, sources: {
                    bank: { source: "bank", buy: 60, sell: 55 },
                } },
            ],
            calculatorMetals: [],
        },
    };
    let response = `<div id="app" data-page='${JSON.stringify(data)}'></div>`;
    const originalFetch = globalThis.fetch;
    let fetches = 0;
    globalThis.fetch = () => { fetches++; return Promise.resolve(new Response(response)); };
    try {
        async function run(text: string): Promise<string> {
            const messages: string[] = [];
            const ctx = {
                message: { text },
                session: { isOperationInProgress: false },
                replyWithChatAction: () => Promise.resolve(),
                reply: (message: string) => { messages.push(message); return Promise.resolve(); },
            };
            await handleCurrencyConversionText(ctx as unknown as MyContext);
            assert(ctx.session.isOperationInProgress === false, "operation flag must reset");
            return messages.join("\n");
        }
        const decimal = await run("150.75 USD");
        assert(decimal.includes("البنك:\nحسب أسعار الشراء: 7839 EGP\nحسب أسعار البيع: 7537.5 EGP"), decimal);
        assert(decimal.includes("السوق:\nحسب أسعار الشراء: 9346.5 EGP\nحسب أسعار البيع: 9045 EGP"), decimal);
        assert(decimal.includes("وليست أسعار تنفيذ"), decimal);
        const target = await run("100 USD to EUR");
        assert(target.includes("البنك:\nحسب أسعار الشراء: 86.67 EUR\nحسب أسعار البيع: 90.91 EUR"), target);
        assert(target.includes("السوق:\nحسب أسعار الشراء: بيانات السعر غير متوفرة\nحسب أسعار البيع: بيانات السعر غير متوفرة"), target);
        assert(!target.includes("5000 EGP") && !target.includes("NaN"), target);
        const inverse = await run("5200 EGP to USD");
        assert(inverse.includes("البنك:\nحسب أسعار الشراء: 100 USD\nحسب أسعار البيع: 104 USD"), inverse);
        const inverseSell = await run("5000 EGP to USD");
        assert(inverseSell.includes("حسب أسعار البيع: 100 USD"), inverseSell);
        const inverseCross = await run("6000 EUR to USD");
        assert(inverseCross.includes("البنك:\nحسب أسعار الشراء: 6923.08 USD\nحسب أسعار البيع: 6600 USD"), inverseCross);
        const fromEgp = await run("100 EGP");
        assert(fromEgp.includes("حسب أسعار الشراء: 1.92 USD\nحسب أسعار البيع: 2 USD"), fromEgp);
        assert(fromEgp.includes("حسب أسعار الشراء: 1.61 USD\nحسب أسعار البيع: 1.67 USD"), fromEgp);
        assert(fromEgp.includes("بيانات السعر غير متوفرة") && !fromEgp.includes("NaN"), fromEgp);
        const beforeIdentity = fetches;
        const identity = await run("10 EUR إلى EUR");
        assert(identity.includes("10 EUR"), identity);
        assert(fetches === beforeIdentity, "identity should not request prices");
        const overflow = await run(`${"9".repeat(308)} USD to EGP`);
        assert(overflow.includes("بيانات السعر غير متوفرة") && !overflow.includes("NaN") && !overflow.includes("Infinity"), overflow);
        for (const text of ["0 USD", "100 XYZ", "100 USD to XYZ", "1e3 USD"]) {
            const message = await run(text);
            assert(message.includes("غير صالح"), message);
        }
        const currencyMessages: string[] = [];
        const currencyCtx = {
            session: { isOperationInProgress: false },
            replyWithChatAction: () => Promise.resolve(),
            reply: (message: string) => { currencyMessages.push(message); return Promise.resolve(); },
        };
        await handleBankPricesRequest(currencyCtx as unknown as MyContext);
        assert(currencyMessages[0].includes("50") && !currencyMessages[0].includes("آخر تحديث"), currencyMessages[0]);
        assert(!currencyCtx.session.isOperationInProgress, "currency operation flag must reset");
        const failedActionMessages: string[] = [];
        const failedActionCtx = {
            message: { text: "1 USD" },
            session: { isOperationInProgress: false },
            replyWithChatAction: () => Promise.reject(new Error("chat action failed")),
            reply: (message: string) => { failedActionMessages.push(message); return Promise.resolve(); },
        };
        await handleCurrencyConversionText(failedActionCtx as unknown as MyContext);
        assert(!failedActionCtx.session.isOperationInProgress && failedActionMessages[0].includes("حدث خطأ"), "failed chat action must release the operation");
        response = "<html></html>";
        const unavailable = await run("1 USD");
        assert(unavailable.includes("حدث خطأ") && !unavailable.includes("NaN"), unavailable);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

import type { MyContext } from "../bot.ts";
import { getCurrencyPrices } from "../services/api.ts";
import type { CurrencyData } from "../services/api.ts";
import { config } from "../app_config.ts";
import { getCurrencyConversionKeyboard } from "../keyboards/index.ts";

/**
 * Handler for the "تحويل العملات 🔄" button
 */
export async function handleCurrencyConversionRequest(ctx: MyContext): Promise<void> {
    if (ctx.session.isOperationInProgress) return;
    await ctx.replyWithChatAction("typing");
    const keyboard = getCurrencyConversionKeyboard();
    const message = `ماذا ترغب في القيام به الآن؟`;
    await ctx.reply(message, { reply_markup: keyboard });
}

/**
 * Handler for the "من الجنية إلي عملة أخرى" button
 */
export async function handleEGPToOtherRequest(ctx: MyContext): Promise<void> {
    if (ctx.session.isOperationInProgress) return;
    try {
        await ctx.replyWithChatAction("typing");
        const message = `من فضلك أدخل المبلغ الذي ترغب في تحويله من الجنية إلى العملات الأخرى بهذه الطريقة في المثال:
4324 EGP`;
        await ctx.reply(message);
    } catch (e) {
        throw e;
    }
}

/**
 * Handler for the "من عملة أخرى إلي الجنية" button
 */
export async function handleOtherToEGPRequest(ctx: MyContext): Promise<void> {
    if (ctx.session.isOperationInProgress) return;
    try {
        await ctx.replyWithChatAction("typing");
        const message = `من فضلك أدخل المبلغ الذي ترغب في تحويله من العملات الأخرى إلى الجنية بهذه الطريقة في المثال:
123 USD
123 EUR
123 SAR
123 AED
123 KWD
123 GBP`;
        await ctx.reply(message);
    } catch (e) {
        throw e;
    }
}

function convertAtRates(amount: number, from: string, to: string, rates: Record<string, CurrencyData>, side: "Buy" | "Sell"): string {
    const sourceRate = from === "EGP" ? 1 : Number(rates[from]?.[side]);
    const targetRate = to === "EGP" ? 1 : Number(rates[to]?.[side]);
    if (!Number.isFinite(sourceRate) || sourceRate <= 0 || !Number.isFinite(targetRate) || targetRate <= 0) {
        return "بيانات السعر غير متوفرة";
    }
    const result = amount * sourceRate / targetRate;
    return Number.isFinite(result) ? `${Number(result.toFixed(2))} ${to}` : "بيانات السعر غير متوفرة";
}

export async function handleCurrencyConversionText(ctx: MyContext): Promise<void> {
    if (ctx.session.isOperationInProgress) return;
    ctx.session.isOperationInProgress = true;
    try {
        await ctx.replyWithChatAction("typing");
        const match = ctx.message?.text?.trim().match(/^(\d+(?:\.\d+)?)\s+([A-Z]{3})(?:\s+(?:to|إلى)\s+([A-Z]{3}))?$/i);
        const amount = Number(match?.[1]);
        const from = match?.[2].toUpperCase();
        const target = match?.[3]?.toUpperCase();
        const supported = ["EGP", ...config.CURRENCIES];
        if (!match || !Number.isFinite(amount) || amount <= 0 || !from || !supported.includes(from) || (target && !supported.includes(target))) {
            await ctx.reply("عذرًا، المبلغ أو العملة غير صالح. أدخل مبلغًا أكبر من الصفر وعملة مدعومة، مثل 150.75 USD أو 100 USD to EUR.");
            return;
        }

        const targets = target ? [target] : from === "EGP" ? config.CURRENCIES : ["EGP"];
        let message = `المبلغ: ${amount} ${from}`;
        // Identity conversion needs no market quote.
        if (targets.length === 1 && targets[0] === from) {
            message += `\n${amount} ${from}`;
        } else {
            const prices = await getCurrencyPrices();
            message += "\nتقديرات حسب أسعار الشراء والبيع المنشورة، وليست أسعار تنفيذ.";
            for (const to of targets) {
                const estimate = (rates: Record<string, CurrencyData>) =>
                    `حسب أسعار الشراء: ${convertAtRates(amount, from, to, rates, "Buy")}\n` +
                    `حسب أسعار البيع: ${convertAtRates(amount, from, to, rates, "Sell")}`;
                message += `\n${to}:\nالبنك:\n${estimate(prices.bank)}\nالسوق:\n${estimate(prices.blackMarket)}`;
            }
        }
        await ctx.reply(message);
    } catch (error) {
        console.error("Error handling currency conversion text:", error);
        await ctx.reply("عذرًا، حدث خطأ أثناء معالجة طلب التحويل. يرجى المحاولة مرة أخرى لاحقًا.\nSorry, an error occurred while processing your conversion request. Please try again later.");
    } finally {
        ctx.session.isOperationInProgress = false;
    }

    await ctx.reply("ماذا ترغب في القيام به الآن؟", { reply_markup: getCurrencyConversionKeyboard() });
}

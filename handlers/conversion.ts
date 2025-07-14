import { MyContext } from "../bot.ts";
import { getCurrencyPrices, convertCurrency } from "../services/api.ts";
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

export async function handleCurrencyConversionText(ctx: MyContext): Promise<void> {
    if (ctx.session.isOperationInProgress && !ctx.message?.text?.startsWith("/cancel")) {
        return;
    }
    ctx.session.isOperationInProgress = true;
    await ctx.replyWithChatAction("typing");
    try {
        const text = ctx.message?.text;

        if (!text) {
            await ctx.reply("عذرًا، لم أتمكن من فهم طلبك");
            return;
        }

        const upperText = text.toUpperCase();
        const regex = /(\d+)(?:\s*)(EGP|USD|EUR|GBP|SAR|AED|KWD)/;
        const match = upperText.match(regex);

        if (!match) {
            await ctx.reply("عذرًا، لم أتمكن من فهم طلبك");
            return;
        }

        const amount = Number(match[1]);
        const currency = match[2];
        const lastPrices = await getCurrencyPrices();

        if (!lastPrices) {
            await ctx.reply("عذرًا، تعذر جلب أسعار الصرف الحالية. يرجى المحاولة مرة أخرى لاحقًا.\nSorry, could not fetch current exchange rates. Please try again later.");
            return;
        }

        let message = `المبلغ المحول: ${amount} ${currency}`;

        if (currency === "EGP") {
            // Convert EGP to all other currencies
            const currencies = ["USD", "EUR", "GBP", "SAR", "AED", "KWD"];

            for (const targetCurrency of currencies) {
            const sell = Number(lastPrices.bank[targetCurrency]?.Sell);
            if (!sell) {
            message += `\n${targetCurrency}: بيانات السعر غير متوفرة`;
            continue;
            }
            const bankRate = Number((amount / sell).toFixed(2));
            const blackRate = Number((amount / Number(lastPrices.blackMarket[targetCurrency]?.Sell)).toFixed(2));

            message += `\n${targetCurrency}:
بالبنك: ${bankRate}
في السوق السوداء: ${blackRate}`;
            }
        } else {
            // Convert from other currency to EGP
            const bankRate = Number((amount * Number(lastPrices.bank[currency]?.Buy)).toFixed(2));
            const blackRate = Number((amount * Number(lastPrices.blackMarket[currency]?.Buy)).toFixed(2));

            message += `\nبالبنك: ${bankRate} EGP
في السوق السوداء: ${blackRate} EGP`;
        }

        await ctx.reply(message);
    } catch (error) {
        console.error("Error handling currency conversion text:", error);
        await ctx.reply("عذرًا، حدث خطأ أثناء معالجة طلب التحويل. يرجى المحاولة مرة أخرى لاحقًا.\nSorry, an error occurred while processing your conversion request. Please try again later.");
    } finally {
        ctx.session.isOperationInProgress = false;
    }

    // Show the conversion keyboard again
    const keyboard = getCurrencyConversionKeyboard();
    const followUpMessage = `ماذا ترغب في القيام به الآن؟`;
    await ctx.reply(followUpMessage, {
        reply_markup: keyboard,
    });
}

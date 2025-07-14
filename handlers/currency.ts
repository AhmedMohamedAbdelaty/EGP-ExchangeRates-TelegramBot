import { MyContext } from "../bot.ts";
import { getCurrencyPrices, getCurrentEgyptTime } from "../services/api.ts";
import {
    getCurrencySummaryKeyboard,
    getCurrencySelectionKeyboard,
    getMainMenuKeyboard
} from "../keyboards/index.ts";
import { config } from "../config.ts";

function getCurrencyName(currency: string): string {
    const names: Record<string, string> = {
        USD: "الدولار الأمريكي",
        EUR: "اليورو",
        GBP: "الجنيه الاسترليني",
        SAR: "الريال السعودي",
        AED: "الدرهم الإماراتي",
        KWD: "الدينار الكويتي",
    };
    return names[currency] || currency;
}

export async function handleCurrencySummaryRequest(ctx: MyContext): Promise<void> {
    if (ctx.session.isOperationInProgress) return;
    ctx.session.isOperationInProgress = true;
    try {
        await ctx.replyWithChatAction("typing");
        const keyboard = getCurrencySummaryKeyboard();
        const message = `أي نوع من الأسعار ترغب في الحصول عليه؟`;
        await ctx.reply(message, { reply_markup: keyboard });
    } finally {
        ctx.session.isOperationInProgress = false;
    }
}

export async function handleSpecificCurrencyRequest(ctx: MyContext): Promise<void> {
    if (ctx.session.isOperationInProgress) return;
    ctx.session.isOperationInProgress = true;
    try {
        await ctx.replyWithChatAction("typing");
        const keyboard = getCurrencySelectionKeyboard(config.CURRENCIES, "specific_currency_");
        const message = `أي عملة ترغب في الحصول على سعرها؟`;
        await ctx.reply(message, { reply_markup: keyboard });
    } finally {
        ctx.session.isOperationInProgress = false;
    }
}

export async function handleBankPricesRequest(ctx: MyContext): Promise<void> {
    if (ctx.session.isOperationInProgress) return;
    ctx.session.isOperationInProgress = true;
    await ctx.replyWithChatAction("typing");
    try {
        const lastPrices = await getCurrencyPrices();
        let message = `أسعار العملات في البنك:\n`;
        let foundData = false;

        config.CURRENCIES.forEach(code => {
            const p = lastPrices.bank[code];
            if (p && (p.Buy && p.Buy !== "N/A" || p.Sell && p.Sell !== "N/A")) {
                message += `\n${getCurrencyName(code)} (${code}):
شراء: ${p.Buy ?? "N/A"}
بيع: ${p.Sell ?? "N/A"}\n`;
                foundData = true;
            }
        });

        if (!foundData) {
            message += "\nلا توجد بيانات أسعار بنكية متاحة حاليًا للعملات المحددة.";
        }

        message += `\nآخر تحديث: ${getCurrentEgyptTime()}`;
        await ctx.reply(message, { reply_markup: getMainMenuKeyboard() });
    } catch (error) {
        console.error("Error handling bank prices request:", error);
        await ctx.reply("عذرًا، حدث خطأ أثناء جلب البيانات. يرجى المحاولة مرة أخرى لاحقًا.", { reply_markup: getMainMenuKeyboard() });
    } finally {
        ctx.session.isOperationInProgress = false;
    }
}

export async function handleBlackMarketPricesRequest(ctx: MyContext): Promise<void> {
    if (ctx.session.isOperationInProgress) return;
    ctx.session.isOperationInProgress = true;
    await ctx.replyWithChatAction("typing");
    try {
        const lastPrices = await getCurrencyPrices();
        let message = `أسعار العملات في السوق السوداء:\n`;
        let foundData = false;

        config.CURRENCIES.forEach(code => {
            const p = lastPrices.blackMarket[code];
            if (p && (p.Buy && p.Buy !== "N/A" || p.Sell && p.Sell !== "N/A")) {
                message += `\n${getCurrencyName(code)} (${code}):
شراء: ${p.Buy ?? "N/A"}
بيع: ${p.Sell ?? "N/A"}\n`;
                foundData = true;
            }
        });

        if (!foundData) {
            message += "\nلا توجد بيانات أسعار سوق سوداء متاحة حاليًا للعملات المحددة.";
        }

        message += `\nآخر تحديث: ${getCurrentEgyptTime()}`;
        await ctx.reply(message, { reply_markup: getMainMenuKeyboard() });
    } catch (error) {
        console.error("Error handling black market prices request:", error);
        await ctx.reply("عذرًا، حدث خطأ أثناء جلب البيانات. يرجى المحاولة مرة أخرى لاحقًا.", { reply_markup: getMainMenuKeyboard() });
    } finally {
        ctx.session.isOperationInProgress = false;
    }
}

export async function handleSpecificCurrency(ctx: MyContext, currency: string): Promise<void> {
    if (ctx.session.isOperationInProgress) return;
    ctx.session.isOperationInProgress = true;
    await ctx.replyWithChatAction("typing");
    try {
        if (!config.CURRENCIES.includes(currency.toUpperCase())) {
            await ctx.reply(`عذرًا، العملة ${currency} غير مدعومة حاليًا.`, { reply_markup: getMainMenuKeyboard() });
            ctx.session.isOperationInProgress = false;
            return;
        }

        const lastPrices = await getCurrencyPrices();
        const currentTime = getCurrentEgyptTime();

        const bankBuy = lastPrices.bank[currency]?.Buy || "N/A";
        const bankSell = lastPrices.bank[currency]?.Sell || "N/A";
        const blackMarketBuy = lastPrices.blackMarket[currency]?.Buy || "N/A";
        const blackMarketSell = lastPrices.blackMarket[currency]?.Sell || "N/A";

        let messageText = `أسعار ${getCurrencyName(currency)} (${currency}):\n`;

        if (bankBuy !== "N/A" || bankSell !== "N/A") {
            messageText += `\nفي البنك (آخر تحديث: ${currentTime}):
شراء: ${bankBuy}
بيع: ${bankSell}\n`;
        } else {
            messageText += `\nأسعار البنك لـ ${getCurrencyName(currency)} غير متاحة حاليًا.\n`;
        }

        if (blackMarketBuy !== "N/A" || blackMarketSell !== "N/A") {
            messageText += `\nفي السوق السوداء (آخر تحديث: ${currentTime}):
شراء: ${blackMarketBuy}
بيع: ${blackMarketSell}`;
        } else {
            messageText += `\nأسعار السوق السوداء لـ ${getCurrencyName(currency)} غير متاحة حاليًا.`;
        }

        await ctx.reply(messageText, { reply_markup: getMainMenuKeyboard() });

    } catch (error) {
        console.error(`Error handling ${currency} request:`, error);
        await ctx.reply("عذرًا، حدث خطأ أثناء جلب البيانات. يرجى المحاولة مرة أخرى لاحقًا.", { reply_markup: getMainMenuKeyboard() });
    } finally {
        ctx.session.isOperationInProgress = false;
    }
}

export async function handleBackToMainMenu(ctx: MyContext): Promise<void> {
    if (ctx.session.isOperationInProgress) {
        if (ctx.callbackQuery?.data === "main_menu_callback") {
            try { await ctx.answerCallbackQuery(); } catch {/* ignore */ }
        }
    }
    await ctx.replyWithChatAction("typing");
    const mainMenu = getMainMenuKeyboard();
    const message = `ماذا ترغب في القيام به الآن؟`;
    await ctx.reply(message, {
        reply_markup: mainMenu,
    });
}

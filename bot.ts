import {
    Bot,
    Context,
    session,
    SessionFlavor,
    conversations,
    createConversation,
    type ConversationFlavor,
    DenoKVAdapter,
} from "./deps.deno.ts";
import { config } from "./config.ts";
import {
    handleStartCommand,
    handleHelpCommand,
    handleInfoCommand,
    handleCurrencySummaryRequest,
    handleSpecificCurrencyRequest,
    handleGoldPricesRequest,
    handleCurrencyConversionRequest,
    handleBankPricesRequest,
    handleBlackMarketPricesRequest,
    handleBackToMainMenu,
    handleEGPToOtherRequest,
    handleOtherToEGPRequest,
    handleCurrencyConversionText,
    handleSpecificCurrency,
    handleSetFavoriteCommand,
    handleMyFavoritesCommand,
    handleMyFavoriteRatesCommand,
    handleFuelPricesRequest,
} from "./handlers/index.ts";
import { currencyConversion } from "./handlers/currency_conversion.conversation.ts";
import { getMainMenuKeyboard } from "./keyboards/index.ts";
import { GrammyError, HttpError } from "https://deno.land/x/grammy@v1.36.1/core/error.ts";

export interface SessionData {
    fromCurrency?: string;
    toCurrency?: string;
    amountToConvert?: number;
    favoriteCurrencies?: string[];
    isOperationInProgress?: boolean;
}

// Context type for the bot, including session and conversation flavor
export type MyContext = Context & SessionFlavor<SessionData> & ConversationFlavor<Context>;
export type InnerContext = Context;

// KV instance (already here, just for context)
const kv = await Deno.openKv();

// Analytics KV Key Prefixes
const KV_ANALYTICS_DAILY_INTERACTIONS_PREFIX = ["analytics", "daily_interactions"];
const KV_ANALYTICS_COMMAND_USAGE_PREFIX = ["analytics", "command_usage"];

if (!config.BOT_TOKEN) {
    throw new Error("CRITICAL: BOT_TOKEN is not defined. Please set it in your .env file or config.");
}

export const bot = new Bot<MyContext>(config.BOT_TOKEN);

// Session middleware
bot.use(session({
    initial: (): SessionData => ({ favoriteCurrencies: [], isOperationInProgress: false }),
    storage: new DenoKVAdapter<SessionData>(kv, ["sessions"]),
}));

// Analytics Middleware
bot.use(async (ctx, next) => {
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
});

bot.use(async (ctx, next) => {
    if (ctx.session.isOperationInProgress) {
        if (ctx.message?.text === "/cancel" || ctx.callbackQuery?.data === "cancel_operation") {
            await next();
            return;
        }
        await ctx.reply("عملية أخرى قيد التنفيذ بالفعل. الرجاء الانتظار أو إلغاء العملية الحالية باستخدام /cancel.");
        return;
    }
    await next();
});

// Conversations middleware
bot.use(conversations());

bot.use(createConversation(currencyConversion, "currencyConversion"));

// Set up bot commands
(async () => {
    await bot.api.setMyCommands([
        {
            command: "start",
            description: "Start the bot and get information about currency rates and gold prices.",
        },
        {
            command: "help",
            description: "Show help information about the bot.",
        },
        {
            command: "info",
            description: "Show information about the developer and the bot.",
        },
        {
            command: "setfav",
            description: "Add or remove a currency from your favorites list (e.g., /setfav USD).",
        },
        {
            command: "myfavs",
            description: "Show your list of favorite currencies.",
        },
        {
            command: "cancel",
            description: "Cancel the current operation.",
        },
    ]);
})();

// Command handlers
bot.command("start", handleStartCommand);
bot.command("help", handleHelpCommand);
bot.command("info", handleInfoCommand);
bot.command("setfav", handleSetFavoriteCommand);
bot.command("myfavs", handleMyFavoritesCommand);

bot.command("cancel", async (ctx) => {
    if (ctx.session.isOperationInProgress) {
        const activeConversations = await ctx.conversation.active();
        if (Object.keys(activeConversations).length > 0) {
            for (const id of Object.keys(activeConversations)) {
                await ctx.conversation.exit(id);
            }
        ctx.session.isOperationInProgress = false;
        await ctx.reply("تم إلغاء العملية الحالية.", { reply_markup: getMainMenuKeyboard() });
        } else {
            ctx.session.isOperationInProgress = false;
            await ctx.reply("تم إلغاء العملية. إذا كنت في منتصف شيء ما، فقد تحتاج إلى البدء من جديد.", { reply_markup: getMainMenuKeyboard() });
        }
    } else {
        await ctx.reply("لا يوجد عملية نشطة حاليًا لإلغائها.", { reply_markup: getMainMenuKeyboard() });
    }
});

// Main menu button handlers
bot.hears("ملخص لجميع العملات 📈💰", handleCurrencySummaryRequest);
bot.hears("🌟 أسعار العملات المفضلة", handleMyFavoriteRatesCommand);
bot.hears("سعر عملة محددة 💱", handleSpecificCurrencyRequest);
bot.hears("🏅 أسعار الذهب", handleGoldPricesRequest);

bot.hears("تحويل العملات 🔄", async (ctx) => {

    if (ctx.session.isOperationInProgress) {
        await ctx.reply("عملية أخرى قيد التنفيذ بالفعل. الرجاء الانتظار أو إلغاء العملية الحالية باستخدام /cancel.");
        return;
    }
    try {
        await handleCurrencyConversionRequest(ctx);
    } catch (e) {
        console.error("Error in 'تحويل العملات 🔄' handler (showing sub-menu): ", e);
        await ctx.reply("حدث خطأ عند عرض خيارات تحويل العملات.");
        ctx.session.isOperationInProgress = false;
    }
});
bot.hears("⛽ أسعار الوقود", handleFuelPricesRequest);
bot.hears("معلومات ℹ️", handleInfoCommand);

// Currency summary handlers
bot.hears("💵 أسعار العملات في البنك", handleBankPricesRequest);
bot.hears("💰 أسعار العملات في السوق السوداء", handleBlackMarketPricesRequest);

// Specific currency handlers
bot.hears("الدولار الأمريكي (USD)", (ctx) => handleSpecificCurrency(ctx, "USD"));
bot.hears("اليورو (EUR)", (ctx) => handleSpecificCurrency(ctx, "EUR"));
bot.hears("الجنيه الاسترليني (GBP)", (ctx) => handleSpecificCurrency(ctx, "GBP"));
bot.hears("الريال السعودي (SAR)", (ctx) => handleSpecificCurrency(ctx, "SAR"));
bot.hears("الدرهم الإماراتي (AED)", (ctx) => handleSpecificCurrency(ctx, "AED"));
bot.hears("الدينار الكويتي (KWD)", (ctx) => handleSpecificCurrency(ctx, "KWD"));

bot.callbackQuery(/specific_currency_(.+)/, async (ctx) => {
    const currencyCode = ctx.match[1];
    await ctx.answerCallbackQuery();
    await handleSpecificCurrency(ctx as MyContext, currencyCode);
});

bot.callbackQuery("main_menu_callback", async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleBackToMainMenu(ctx as MyContext);
});

bot.hears("من الجنية إلي عملة أخرى", handleEGPToOtherRequest);
bot.hears("من عملة أخرى إلي الجنية", handleOtherToEGPRequest);

bot.hears("🔙 العودة إلى القائمة الرئيسية", handleBackToMainMenu);

// Handle text messages for currency conversion
bot.on("message:text", async (ctx) => {
    const text = ctx.message?.text;
    // e.g., "100 USD to EGP" or "100 EGP"
    const quickConversionRegex = /^(\d+(\.\d+)?)\s+([A-Z]{3})(\s+(to|إلى)\s+([A-Z]{3}))?$/i;
    const egpToOthersRegex = /^(\d+(\.\d+)?)\s+EGP$/i;

    if (quickConversionRegex.test(text || "") || egpToOthersRegex.test(text || "")) {
        if (ctx.session.isOperationInProgress && text !== "/cancel") {
            return;
        }
        return handleCurrencyConversionText(ctx);
    }
});

// Global error handler
bot.catch(async (err) => {
    const ctx = err.ctx;
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] Error handling update ${ctx.update.update_id}:`, err.error);
    console.error(`[${timestamp}] Context:`, JSON.stringify(ctx, null, 2));

    try {
        await ctx.reply("عذرًا، حدث خطأ ما. لقد تم إخطار المطورين. يرجى المحاولة مرة أخرى لاحقًا.");
    } catch (replyError) {
        console.error(`[${timestamp}] Failed to send error message to user:`, replyError);
    }

    const e = err.error;
    if (e instanceof GrammyError) {
        console.error(`[${timestamp}] Error in request (GrammyError):`, e.description, e.payload);
    } else if (e instanceof HttpError) {
        console.error(`[${timestamp}] Could not contact Telegram (HttpError):`, e);
    } else {
        console.error(`[${timestamp}] Unknown error:`, e);
    }
});

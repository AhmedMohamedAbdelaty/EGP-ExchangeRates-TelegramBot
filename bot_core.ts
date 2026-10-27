import {
    Bot,
    type Context,
    type SessionFlavor,
    conversations,
    createConversation,
    type ConversationFlavor,
    GrammyError,
    HttpError,
} from "./deps.deno.ts";
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

type BotMiddleware = (ctx: MyContext, next: () => Promise<void>) => Promise<void>;

// Runtime-specific session persistence and analytics are supplied by the caller.
export function createBot(
    token: string,
    sessionMiddleware: BotMiddleware,
    analyticsMiddleware?: BotMiddleware,
): Bot<MyContext> {
    if (!token) throw new Error("CRITICAL: BOT_TOKEN is not defined. Please set it in your environment.");
    const bot = new Bot<MyContext>(token);
    bot.use(sessionMiddleware);
    if (analyticsMiddleware) bot.use(analyticsMiddleware);

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

    // Command handlers
    bot.command("start", handleStartCommand);
    bot.command("help", handleHelpCommand);
    bot.command("info", handleInfoCommand);
    bot.command("setfav", handleSetFavoriteCommand);
    bot.command("myfavs", handleMyFavoritesCommand);

    bot.command("cancel", async (ctx) => {
        const activeConversations = await ctx.conversation.active();
        const wasActive = ctx.session.isOperationInProgress || Object.keys(activeConversations).length > 0;
        for (const id of Object.keys(activeConversations)) {
            await ctx.conversation.exit(id);
        }
        ctx.session.isOperationInProgress = false;
        await ctx.reply(wasActive ? "تم إلغاء العملية الحالية." : "لا يوجد عملية نشطة حاليًا لإلغائها.", {
            reply_markup: getMainMenuKeyboard(),
        });
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
    bot.hears("💰 أسعار السوق", handleBlackMarketPricesRequest);

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
    bot.on("message:text", (ctx) => {
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
        console.error(`[${timestamp}] Error handling update ${ctx.update.update_id}`);

        try {
            await ctx.reply("عذرًا، حدث خطأ ما. يرجى المحاولة مرة أخرى لاحقًا.");
        } catch {
            console.error(`[${timestamp}] Failed to send error message to user`);
        }

        const e = err.error;
        if (e instanceof GrammyError) {
            console.error(`[${timestamp}] Telegram request failed:`, e.description);
        } else if (e instanceof HttpError) {
            console.error(`[${timestamp}] Could not contact Telegram`);
        } else {
            console.error(`[${timestamp}] Handler failed:`, e instanceof Error ? e.name : "unknown error");
        }
    });

    return bot;
}

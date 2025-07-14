import type { Conversation } from "../deps.deno.ts";
import type { MyContext, InnerContext } from "../bot.ts";
import { getCurrencySelectionKeyboard, getMainMenuKeyboard } from "../keyboards/index.ts";
import { AllCurrencyPrices, convertCurrency, getCurrencyPrices } from "../services/api.ts";
import { config } from "../config.ts";

export async function currencyConversion(
    conversation: Conversation<MyContext, InnerContext>,
    ctx: InnerContext,
): Promise<void> {
    const outerCtx = ctx as MyContext;
    outerCtx.session.isOperationInProgress = true;

    try {
        await ctx.replyWithChatAction("typing");
        await ctx.reply("ما هو المبلغ الذي ترغب في تحويله؟ (مثال: 100 أو 150.75)");

        let amount: number | undefined;
        while (amount === undefined) {
            await ctx.replyWithChatAction("typing");
            const amountCtx = await conversation.waitFor("message:text");
            const parsedAmount = parseFloat(amountCtx.message.text.trim());

            if (isNaN(parsedAmount) || parsedAmount <= 0) {
                await amountCtx.reply("عذرًا، المبلغ غير صالح. الرجاء إدخال رقم صحيح أكبر من الصفر. مثال: 100 أو 150.75");
            } else {
                amount = parsedAmount;
            }
        }
        await ctx.replyWithChatAction("typing");
        await ctx.reply(`تم تحديد المبلغ: ${amount}. الآن، من أي عملة تريد التحويل؟`, {
            reply_markup: getCurrencySelectionKeyboard(config.CURRENCIES, "convert_from_"),
        });
        await ctx.replyWithChatAction("typing");
        const fromCurrencyCtx = await conversation.waitForCallbackQuery(/convert_from_(.+)/);
        const fromCurrency = fromCurrencyCtx.match?.[1];
        await fromCurrencyCtx.answerCallbackQuery();

        if (!fromCurrency || !config.CURRENCIES.includes(fromCurrency.toUpperCase())) {
            await ctx.replyWithChatAction("typing");
            await fromCurrencyCtx.reply("اختيار العملة المصدر غير صالح. تم إلغاء عملية التحويل.");
            return;
        }
        await ctx.replyWithChatAction("typing");
        await fromCurrencyCtx.editMessageText(`ستقوم بالتحويل من ${fromCurrency}. إلى أي عملة تريد التحويل؟`, {
            reply_markup: getCurrencySelectionKeyboard(config.CURRENCIES.filter(c => c !== fromCurrency), "convert_to_"),
        });
        await ctx.replyWithChatAction("typing");
        const toCurrencyCtx = await conversation.waitForCallbackQuery(/convert_to_(.+)/);
        const toCurrency = toCurrencyCtx.match?.[1];
        await toCurrencyCtx.answerCallbackQuery();

        if (!toCurrency || !config.CURRENCIES.includes(toCurrency.toUpperCase())) {
            await ctx.replyWithChatAction("typing");
            await toCurrencyCtx.reply("اختيار العملة الهدف غير صالح. تم إلغاء عملية التحويل.");
            return;
        }
        await ctx.replyWithChatAction("typing");
        await toCurrencyCtx.editMessageText(`جاري تحويل ${amount} ${fromCurrency} إلى ${toCurrency}...`);

        try {
            const result = await conversation.external(() => convertCurrency(amount as number, fromCurrency, toCurrency));
            await toCurrencyCtx.reply(
                `${amount} ${result.from} = ${result.convertedAmount} ${result.to}\n` +
                `سعر الصرف: 1 ${result.from} = ${result.rate} ${result.to}`,
                { reply_markup: getMainMenuKeyboard() },
            );
        } catch (error: any) {
            await toCurrencyCtx.reply(
                `حدث خطأ أثناء التحويل: ${error.message || 'يرجى المحاولة مرة أخرى.'}`,
                { reply_markup: getMainMenuKeyboard() },
            );
        }
    } catch (e) {
        console.error("Error within currencyConversion conversation: ", e);
        await ctx.reply("تم إلغاء عملية تحويل العملات أو حدث خطأ ما.", { reply_markup: getMainMenuKeyboard() });
    } finally {
        outerCtx.session.isOperationInProgress = false;
    }
}

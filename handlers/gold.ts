import { MyContext } from "../bot.ts";
import { getGoldPrices, GoldPriceEntry, getCurrentEgyptTime } from "../services/api.ts";
import { getMainMenuKeyboard } from "../keyboards/index.ts";

function formatGoldPrice(priceEntry?: GoldPriceEntry): string {
    if (!priceEntry) return "N/A";
    if (priceEntry.buy && priceEntry.sell) {
        return `شراء: ${priceEntry.buy} | بيع: ${priceEntry.sell}`;
    }
    return priceEntry.price || "N/A";
}

export async function handleGoldPricesRequest(ctx: MyContext): Promise<void> {
    if (ctx.session.isOperationInProgress) return;
    ctx.session.isOperationInProgress = true;
    await ctx.replyWithChatAction("typing");
    try {
        const lastPrices = await getGoldPrices();

        const message = `أسعار الذهب:

الذهب عيار 24:
${formatGoldPrice(lastPrices.prices["24k"])}

الذهب عيار 21:
${formatGoldPrice(lastPrices.prices["21k"])}

الذهب عيار 18:
${formatGoldPrice(lastPrices.prices["18k"])}

الذهب عيار 22:
${formatGoldPrice(lastPrices.prices["22k"])}

الأونصة الذهب:
${formatGoldPrice(lastPrices.prices["Gold Ounce"])}

الجنيه الذهب:
${formatGoldPrice(lastPrices.prices["Gold Pound(Coin)"])}

آخر تحديث: ${getCurrentEgyptTime()}`;

        await ctx.reply(message);

        // After displaying gold prices, show the main menu again
        const mainMenu = getMainMenuKeyboard();
        const followUpMessage = `ماذا ترغب في القيام به الآن؟`;

        await ctx.reply(followUpMessage, {
            reply_markup: mainMenu,
        });
    } catch (error) {
        console.error("Error handling gold prices request:", error);
        await ctx.reply("عذرًا، حدث خطأ أثناء جلب البيانات. يرجى المحاولة مرة أخرى لاحقًا.\nSorry, an error occurred while fetching data. Please try again later.");
    } finally {
        ctx.session.isOperationInProgress = false;
    }
}

import { MyContext } from "../bot.ts";
import { getFuelPrices, getCurrentEgyptTime } from "../services/api.ts";
import { getMainMenuKeyboard } from "../keyboards/index.ts";
import { config } from "../config.ts";

function getFuelTypeName(fuelType: string): string {
    const names: Record<string, string> = {
        "Octane 80": "بنزين 80",
        "Octane 90": "بنزين 90",
        "Octane 95": "بنزين 95",
    };
    return names[fuelType] || fuelType;
}

export async function handleFuelPricesRequest(ctx: MyContext): Promise<void> {
    if (ctx.session.isOperationInProgress) return;
    ctx.session.isOperationInProgress = true;
    await ctx.replyWithChatAction("typing");
    try {
        const fuelData = await getFuelPrices();
        const currentTime = getCurrentEgyptTime();

        let message = `دي أسعار البنزين والوقود في مصر دلوقتي ⛽:\n`;

        if (Object.keys(fuelData.prices).length > 0) {
            for (const fuelType of config.FUEL_TYPES) {
                const price = fuelData.prices[fuelType] || "مش متاح";
                const arabicName = getFuelTypeName(fuelType);
                const arabicPrice = price.replace(/GP/g, "جنية");
                message += `\n⛽ ${arabicName}: ${arabicPrice}`;
            }
            message += `\n\n📅 آخر تحديث: ${currentTime}`;
        } else {
            message += "\nآسف، أسعار الوقود مش متاحة دلوقتي 😕";
        }

        await ctx.reply(message, { reply_markup: getMainMenuKeyboard() });

    } catch (error) {
        console.error("Error handling fuel prices request:", error);
        await ctx.reply("آسف، حصل خطأ لما كنت بجيب أسعار الوقود 😓. جرب تاني بعد شوية.", {
            reply_markup: getMainMenuKeyboard(),
        });
    } finally {
        ctx.session.isOperationInProgress = false;
    }
}

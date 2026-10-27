import type { MyContext } from "../bot.ts";
import { getFuelPrices } from "../services/api.ts";
import { getMainMenuKeyboard } from "../keyboards/index.ts";
import { config } from "../app_config.ts";

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
    try {
        await ctx.replyWithChatAction("typing");
        const fuelData = await getFuelPrices();

        let message = `دي أسعار البنزين والوقود في مصر دلوقتي ⛽:\n`;

        if (Object.keys(fuelData.prices).length > 0) {
            for (const fuelType of config.FUEL_TYPES) {
                const price = fuelData.prices[fuelType] || "مش متاح";
                const arabicName = getFuelTypeName(fuelType);
                const arabicPrice = price.replace(/EGP|GP/g, "جنية");
                message += `\n⛽ ${arabicName}: ${arabicPrice}`;
            }
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

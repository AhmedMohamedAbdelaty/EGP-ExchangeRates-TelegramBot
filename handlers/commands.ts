import { MyContext } from "../bot.ts";
import { getMainMenuKeyboard, getCurrencySelectionKeyboard } from "../keyboards/index.ts";
import { config } from "../config.ts";
import { getCurrencyPrices, getCurrentEgyptTime } from "../services/api.ts";

function escapeMarkdownV2(text: string): string {
    const escapeChars = ['_', '*', '[', ']', '(', ')', '~', '`', '>', '<', '#', '+', '-', '=', '|', '{', '}', '.', '!'];
    return text.split('').map(char => escapeChars.includes(char) ? `\\${char}` : char).join('');
}

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

export async function handleInfoCommand(ctx: MyContext): Promise<void> {
    if (ctx.session.isOperationInProgress) return;
    ctx.session.isOperationInProgress = true;
    try {
        const githubUser = "AhmedMohamedAbdelaty";
        const escapedGithubUser = escapeMarkdownV2(githubUser);
        const supportedCurrenciesText = config.CURRENCIES.join(", ");

        const infoMessage = `ℹ️ *Hey there\\! Here's a little about me and the bot*

👋 I'm a little bot put together by Ahmed to help you check out currency and gold prices in Egypt\\.

*Who's the dev\\?*
That'd be Ahmed Mohamed Abdelaty\\!
🔗 You can find him on GitHub: [${escapedGithubUser}](https://github.com/${githubUser})

🤖 *So, what's this bot all about\\?*
This bot fetches currency and gold prices from forexfy\\.app, and fuel prices from sarf\\-today\\.com\\.
Right now, I can tell you about these currencies: ${escapeMarkdownV2(supportedCurrenciesText)}\\.
Just a heads up, I'm just the messenger here – Ahmed didn't build those websites\\.

🛠️ *Why does this bot exist\\?*
Ahmed made this bot as a fun little project while learning Deno, TypeScript, and how Telegram bots work\\.
It's a work in progress, so if you spot any issues or have ideas, feel free to let him know\\!
Thanks for using the bot and understanding\\! 😊`;

        await ctx.reply(infoMessage, {
            reply_markup: getMainMenuKeyboard(),
            parse_mode: "MarkdownV2",
        });
    } catch (error) {
        console.error("Error in handleInfoCommand:", error);
        const fallbackMessage = "Oops! Something went wrong showing the info. This bot was made by Ahmed Mohamed Abdelaty (GitHub: AhmedMohamedAbdelaty) and gets prices from forexfy.app and sarf-today.com.";
        try {
            await ctx.reply(fallbackMessage, { reply_markup: getMainMenuKeyboard() });
        } catch (fallbackError) {
            console.error("Error sending fallback info message:", fallbackError);
        }
    }
    finally {
        ctx.session.isOperationInProgress = false;
    }
}

export async function handleStartCommand(ctx: MyContext): Promise<void> {
    if (ctx.session.isOperationInProgress) return;
    ctx.session.isOperationInProgress = true;
    try {
        const mainMenu = getMainMenuKeyboard();
        const userName = ctx.from?.first_name || "مستخدمنا العزيز";

        const welcomeMessage = `مرحبًا بك يا ${userName}! 🤖💰

يمكنك الحصول على أسعار العملات للجنيه المصري في البنوك والسوق السوداء، وأسعار الذهب، ويمكنك أيضًا استخدام خدمة تحويل العملات.

اختر أحد الخيارات التالية للمتابعة:`;

        await ctx.reply(welcomeMessage, {
            reply_markup: mainMenu,
        });
    } finally {
        ctx.session.isOperationInProgress = false;
    }
}

export async function handleHelpCommand(ctx: MyContext): Promise<void> {
    if (ctx.session.isOperationInProgress) return;
    ctx.session.isOperationInProgress = true;
    try {
        const helpMessage = `Hey\\! Here's what I can do:

/start \\- Get things rolling and see the main menu\\.
/help \\- Show this help message\\.
/info \\- A little about me and my creator\\.
/setfav \\<CODE\\> \\- Add/remove a currency to your faves (e\\.g\\., /setfav USD)\\. Supported: ${escapeMarkdownV2(config.CURRENCIES.join(", "))}
/myfavs \\- Check out your favorite currencies and their rates\\.
/cancel \\- Stop the current thing I'm doing\\.

You can also just tap the buttons on the menu\\! 👍`;
        await ctx.reply(helpMessage, {parse_mode: "MarkdownV2"});
    } finally {
        ctx.session.isOperationInProgress = false;
    }
}

export async function handleSetFavoriteCommand(ctx: MyContext): Promise<void> {
    if (ctx.session.isOperationInProgress) return;
    ctx.session.isOperationInProgress = true;
    try {
        const args = ctx.message?.text?.trim().split(/\s+/) ?? [];
        const currencyCode = args[1]?.toUpperCase();
        if (!currencyCode) {
            await ctx.reply(`Please specify a currency code\\. Example: /setfav USD\\. Available: ${escapeMarkdownV2(config.CURRENCIES.join(", "))}`, {parse_mode: "MarkdownV2"});
            ctx.session.isOperationInProgress = false;
            return;
        }

        if (!config.CURRENCIES.includes(currencyCode)) {
            await ctx.reply(`Invalid currency code: ${escapeMarkdownV2(currencyCode)}\\. Available: ${escapeMarkdownV2(config.CURRENCIES.join(", "))}`, {parse_mode: "MarkdownV2"});
            ctx.session.isOperationInProgress = false;
            return;
        }

        const favorites = ctx.session.favoriteCurrencies || [];
        const index = favorites.indexOf(currencyCode);

        if (index > -1) {
            favorites.splice(index, 1);
            ctx.session.favoriteCurrencies = favorites;
            await ctx.reply(`Removed ${escapeMarkdownV2(currencyCode)} from your favorites\\.`, {parse_mode: "MarkdownV2"});
        } else {
            if (favorites.length >= config.CURRENCIES.length) {
                 await ctx.reply(`Sorry, you can add a maximum of ${config.CURRENCIES.length} favorite currencies\\.`, {parse_mode: "MarkdownV2"});
                 ctx.session.isOperationInProgress = false;
                 return;
            }
            if (favorites.length >= 5) {
                await ctx.reply("Sorry, you can add a maximum of 5 favorite currencies\\.", {parse_mode: "MarkdownV2"});
                ctx.session.isOperationInProgress = false;
                return;
            }
            favorites.push(currencyCode);
            ctx.session.favoriteCurrencies = favorites;
            await ctx.reply(`Added ${escapeMarkdownV2(currencyCode)} to your favorites\\.`, {parse_mode: "MarkdownV2"});
        }
    } finally {
        ctx.session.isOperationInProgress = false;
    }
}

export async function handleMyFavoritesCommand(ctx: MyContext): Promise<void> {
    if (ctx.session.isOperationInProgress) return;
    ctx.session.isOperationInProgress = true;
    try {
        const favorites = ctx.session.favoriteCurrencies || [];
        if (favorites.length === 0) {
            await ctx.reply(`You don't have any favorite currencies yet\\. Use /setfav \\<CODE\\> to add one\\. Available: ${escapeMarkdownV2(config.CURRENCIES.join(", "))}`, {parse_mode: "MarkdownV2"});
            ctx.session.isOperationInProgress = false;
            return;
        }
        const message = "Your favorite currencies:\n" + favorites.map(fav => `\\- ${escapeMarkdownV2(fav)}`).join("\n");
        await ctx.reply(message, {parse_mode: "MarkdownV2"});
    } finally {
        ctx.session.isOperationInProgress = false;
    }
}

export async function handleMyFavoriteRatesCommand(ctx: MyContext): Promise<void> {
    if (ctx.session.isOperationInProgress) return;
    ctx.session.isOperationInProgress = true;
    await ctx.replyWithChatAction("typing");
    const favorites = ctx.session.favoriteCurrencies || [];

    if (favorites.length === 0) {
        await ctx.reply(`مفيش عملات مفضلة حالياً 😅\\. استخدم /setfav \\<الكود\\> عشان تضيف واحدة\\. العملات المتاحة: ${escapeMarkdownV2(config.CURRENCIES.join(", "))}`, {
            reply_markup: getMainMenuKeyboard(),
            parse_mode: "MarkdownV2"
        });
        ctx.session.isOperationInProgress = false;
        return;
    }

    try {
        const allPrices = await getCurrencyPrices();
        let message = "دي أسعار عملاتك المفضلة 🌟:\n";
        const currentTime = getCurrentEgyptTime();
        let foundAnyRate = false;

        for (const fav of favorites) {
            if (!config.CURRENCIES.includes(fav)) continue;

            const bankBuy = allPrices.bank[fav]?.Buy;
            const bankSell = allPrices.bank[fav]?.Sell;
            const blackMarketBuy = allPrices.blackMarket[fav]?.Buy;
            const blackMarketSell = allPrices.blackMarket[fav]?.Sell;

            let currencySection = `\n🔷 ${escapeMarkdownV2(fav)}:`;
            let hasRateForFav = false;

            if (bankBuy && bankSell && bankBuy !== "N/A" && bankSell !== "N/A") {
                currencySection += `\n   🏦 البنوك:
      شراء: ${escapeMarkdownV2(bankBuy)} \\| بيع: ${escapeMarkdownV2(bankSell)}`;
                hasRateForFav = true;
            }
            if (blackMarketBuy && blackMarketSell && blackMarketBuy !== "N/A" && blackMarketSell !== "N/A") {
                currencySection += `\n   ⚫ السوق السوداء:
      شراء: ${escapeMarkdownV2(blackMarketBuy)} \\| بيع: ${escapeMarkdownV2(blackMarketSell)}`;
                hasRateForFav = true;
            }

            if(hasRateForFav) {
                message += currencySection + "\n\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-";
                foundAnyRate = true;
            }
        }
        if (!foundAnyRate) {
            message = "للأسف مقدرتش ألاقي أسعار لأي من عملاتك المفضلة دلوقتي 😕\\.";
        } else {
            message += `\n\n📅 آخر تحديث: ${escapeMarkdownV2(currentTime)}`;
        }

        await ctx.reply(message, { reply_markup: getMainMenuKeyboard(), parse_mode: "MarkdownV2" });
    } catch (error) {
        console.error("Error fetching favorite rates:", error);
        const fallbackErrorMessage = "آسف، حصل خطأ لما كنت بجيب أسعار عملاتك المفضلة 😓\\. جرب تاني بعد شوية\\.";
        await ctx.reply(fallbackErrorMessage, {
            reply_markup: getMainMenuKeyboard(),
        });
    } finally {
        ctx.session.isOperationInProgress = false;
    }
}

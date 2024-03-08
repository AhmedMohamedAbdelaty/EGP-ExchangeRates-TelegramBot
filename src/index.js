import { Bot, webhookCallback, Keyboard } from "grammy";
import cheerio from "cheerio";
import dotenv from "dotenv";

dotenv.config();
const BOT_TOKEN = "process.env.BOT_TOKEN";

const bot = new Bot(BOT_TOKEN);

(async () => {
	await bot.api.setMyCommands([
		{
			command: "start",
			description:
				"Start the bot and get information about currency rates and gold prices.",
		},
	]);
})();

let savedPrices, savedGoldPrices;
let blackMarketPrices = async function () {
	let response, body, $;
	let lastUpdate;

	try {
		response = await fetch(
			"https://egcurrency.com/en/currency/egp/exchange"
		);
		body = await response.text();
		$ = cheerio.load(body);
		const blackPrice = {
			USD: {
				Buy: $("tr[data-href='/en/currency/usd-to-egp/exchange']")
					.find("td")
					.eq(1)
					.text(),
				Sell: $("tr[data-href='/en/currency/usd-to-egp/exchange']")
					.find("td")
					.eq(2)
					.text(),
			},
			EUR: {
				Buy: $("tr[data-href='/en/currency/eur-to-egp/exchange']")
					.find("td")
					.eq(1)
					.text(),
				Sell: $("tr[data-href='/en/currency/eur-to-egp/exchange']")
					.find("td")
					.eq(2)
					.text(),
			},
			GBP: {
				Buy: $("tr[data-href='/en/currency/gbp-to-egp/exchange']")
					.find("td")
					.eq(1)
					.text(),
				Sell: $("tr[data-href='/en/currency/gbp-to-egp/exchange']")
					.find("td")
					.eq(2)
					.text(),
			},
			SAR: {
				Buy: $("tr[data-href='/en/currency/sar-to-egp/exchange']")
					.find("td")
					.eq(1)
					.text(),
				Sell: $("tr[data-href='/en/currency/sar-to-egp/exchange']")
					.find("td")
					.eq(2)
					.text(),
			},
			AED: {
				Buy: $("tr[data-href='/en/currency/aed-to-egp/exchange']")
					.find("td")
					.eq(1)
					.text(),
				Sell: $("tr[data-href='/en/currency/aed-to-egp/exchange']")
					.find("td")
					.eq(2)
					.text(),
			},
			KWD: {
				Buy: $("tr[data-href='/en/currency/kwd-to-egp/exchange']")
					.find("td")
					.eq(1)
					.text(),
				Sell: $("tr[data-href='/en/currency/kwd-to-egp/exchange']")
					.find("td")
					.eq(2)
					.text(),
			},
		};
		response = await fetch("https://egcurrency.com/en/currency/egp/cbe");
		body = await response.text();
		$ = cheerio.load(body);
		const bankPrice = {
			USD: {
				Buy: $("tr[data-href='/en/currency/usd-to-egp/cbe']")
					.find("td")
					.eq(1)
					.text(),
				Sell: $("tr[data-href='/en/currency/usd-to-egp/cbe']")
					.find("td")
					.eq(2)
					.text(),
			},
			EUR: {
				Buy: $("tr[data-href='/en/currency/eur-to-egp/cbe']")
					.find("td")
					.eq(1)
					.text(),
				Sell: $("tr[data-href='/en/currency/eur-to-egp/cbe']")
					.find("td")
					.eq(2)
					.text(),
			},
			GBP: {
				Buy: $("tr[data-href='/en/currency/gbp-to-egp/cbe']")
					.find("td")
					.eq(1)
					.text(),
				Sell: $("tr[data-href='/en/currency/gbp-to-egp/cbe']")
					.find("td")
					.eq(2)
					.text(),
			},
			SAR: {
				Buy: $("tr[data-href='/en/currency/sar-to-egp/cbe']")
					.find("td")
					.eq(1)
					.text(),
				Sell: $("tr[data-href='/en/currency/sar-to-egp/cbe']")
					.find("td")
					.eq(2)
					.text(),
			},
			AED: {
				Buy: $("tr[data-href='/en/currency/aed-to-egp/cbe']")
					.find("td")
					.eq(1)
					.text(),
				Sell: $("tr[data-href='/en/currency/aed-to-egp/cbe']")
					.find("td")
					.eq(2)
					.text(),
			},
			KWD: {
				Buy: $("tr[data-href='/en/currency/kwd-to-egp/cbe']")
					.find("td")
					.eq(1)
					.text(),
				Sell: $("tr[data-href='/en/currency/kwd-to-egp/cbe']")
					.find("td")
					.eq(2)
					.text(),
			},
		};
		lastUpdate = new Date().toLocaleString("en-US", {
			timeZone: "Africa/Cairo",
		});
		const data = {
			blackPrice,
			bankPrice,
			lastUpdate,
		};
		savedPrices = data;
		return data;
	} catch (error) {
		if (savedPrices) {
			return savedPrices;
		} else {
			throw new Error("Could not retrieve the data");
		}
	}
};
let goldPrices = async function () {
	// https://egcurrency.com/en/gold/egp
	// 24k: /en/gold/24-karat-in-egp, 21k:/en/gold/21-karat-in-egp, 18k: /en/gold/18-karat-in-egp, 22k: /en/gold/22-karat-in-egp
	// Gold Ounce: /en/gold/gold-ounce-in-egp
	// Gold Pound(Coin): /en/gold/gold-coin-in-egp

	let response, body, $;
	let lastUpdate;

	try {
		response = await fetch("https://egcurrency.com/en/gold/egp");
		body = await response.text();
		$ = cheerio.load(body);
		const goldPrice = {
			"24k": $("tr[data-href='/en/gold/24-karat-in-egp']")
				.find("td")
				.eq(1)
				.text(),
			"21k": $("tr[data-href='/en/gold/21-karat-in-egp']")
				.find("td")
				.eq(1)
				.text(),
			"18k": $("tr[data-href='/en/gold/18-karat-in-egp']")
				.find("td")
				.eq(1)
				.text(),
			"22k": $("tr[data-href='/en/gold/22-karat-in-egp']")
				.find("td")
				.eq(1)
				.text(),
			"Gold Ounce": $("tr[data-href='/en/gold/gold-ounce-in-egp']")
				.find("td")
				.eq(1)
				.text(),
			"Gold Pound(Coin)": $("tr[data-href='/en/gold/gold-coin-in-egp']")
				.find("td")
				.eq(1)
				.text(),
		};
		lastUpdate = new Date().toLocaleString("en-US", {
			timeZone: "Africa/Cairo",
		});
		const data = {
			goldPrice,
			lastUpdate,
		};
		savedGoldPrices = data;
		return data;
	} catch (error) {
		if (savedGoldPrices) {
			return savedGoldPrices;
		} else {
			throw new Error("Could not retrieve the data");
		}
	}
};
bot.command("start", async (ctx) => {
	const mainMenu = new Keyboard()
		.text("ملخص لجميع العملات 📈💰")
		.row()
		.text("سعر عملة محددة 💱")
		.row()
		.text("🏅 أسعار الذهب")
		.text("تحويل العملات 🔄")
		.row()
		.text("معلومات ℹ️")
		.resized()
		.oneTime();
	const welcomeMessage = `مرحبًا بك! 🤖💰

	يمكنك الحصول على أسعار العملات للجنيه المصري في البنوك والسوق السوداء، وأسعار الذهب، ويمكنك أيضًا استخدام خدمة تحويل العملات.
	
	اختر أحد الخيارات التالية للمتابعة:
	1️⃣ ملخص لجميع العملات
	2️⃣ سعر عملة محددة
	3️⃣ سعر الذهب
	4️⃣ تحويل العملات
	5️⃣ معلومات إضافية`;

	await ctx.reply(welcomeMessage, {
		reply_markup: mainMenu,
	});
});
bot.hears("ملخص لجميع العملات 📈💰", async (ctx) => {
	const mainMenu = new Keyboard()
		.text("💵 أسعار العملات في البنك")
		.row()
		.text("💰 أسعار العملات في السوق السوداء")
		.row()
		.text("🔙 العودة إلى القائمة الرئيسية")
		.resized();
	// .oneTime();

	const message = `أي نوع من الأسعار ترغب في الحصول عليه؟`;
	await ctx.reply(message, {
		reply_markup: mainMenu,
	});
});
bot.hears("سعر عملة محددة 💱", async (ctx) => {
	const currencyMenu = new Keyboard()
		.text("الدولار الأمريكي (USD)")
		.text("اليورو (EUR)")
		.row()
		.text("الريال السعودي (SAR)")
		.text("الدرهم الإماراتي (AED)")
		.row()
		.text("الدينار الكويتي (KWD)")
		.text("الجنيه الاسترليني (GBP)")
		.row()
		.text("🔙 العودة إلى القائمة الرئيسية")
		.resized();
	// .oneTime();
	const message = `أي عملة ترغب في الحصول على سعرها؟`;
	await ctx.reply(message, {
		reply_markup: currencyMenu,
	});
});
bot.hears("🏅 أسعار الذهب", async (ctx) => {
	const lastPrices = await goldPrices();
	if (lastPrices) {
		const message = `أسعار الذهب:
		
		الذهب عيار 24:
		${lastPrices.goldPrice["24k"] || "N/A"}
		
		الذهب عيار 21:
		${lastPrices.goldPrice["21k"] || "N/A"}
		
		الذهب عيار 18:
		${lastPrices.goldPrice["18k"] || "N/A"}
		
		الذهب عيار 22:
		${lastPrices.goldPrice["22k"] || "N/A"}
		
		الأونصة الذهب:
		${lastPrices.goldPrice["Gold Ounce"] || "N/A"}
		
		الجنيه الذهب:
		${lastPrices.goldPrice["Gold Pound(Coin)"] || "N/A"}
		
		آخر تحديث: ${lastPrices.lastUpdate || "N/A"}`;
		await ctx.reply(message);
	} else {
		await ctx.reply("تعذر إرسال الرسالة");
	}
	const mainMenu = new Keyboard()
		.text("ملخص لجميع العملات 📈💰")
		.row()
		.text("سعر عملة محددة 💱")
		.row()
		.text("🏅 أسعار الذهب")
		.text("تحويل العملات 🔄")
		.row()
		.text("معلومات ℹ️")
		.resized()
		.oneTime();
	const message = `ماذا ترغب في القيام به الآن؟`;
	await ctx.reply(message, {
		reply_markup: mainMenu,
	});
});
bot.hears("تحويل العملات 🔄", async (ctx) => {
	const mainMenu = new Keyboard()
		.text(`من الجنية إلي عملة أخرى`)
		.row()
		.text(`من عملة أخرى إلي الجنية`)
		.row()
		.text("🔙 العودة إلى القائمة الرئيسية")
		.resized();
	const message = `ماذا ترغب في القيام به الآن؟`;
	await ctx.reply(message, {
		reply_markup: mainMenu,
	});
});
bot.hears("معلومات ℹ️", async (ctx) => {
	const message = `Developer Information:
	- GitHub: [AhmedMohamedAbdelaty](https://github.com/AhmedMohamedAbdelaty)
	- Twitter: [ahmed_muhamed24](https://twitter.com/ahmed_muhamed24)

This bot retrieves currency prices from [egcurrency.com](https://egcurrency.com/en). Please note that I am not the developer of this website.

This project is a small practice on JavaScript and Telegram bots. While the code and the bot may have some issues, I am happy to receive feedback and will try to address any problems. Thank you for your understanding.`;
	await ctx.reply(message, {
		parse_mode: "Markdown",
	});

	const mainMenu = new Keyboard()
		.text("🔙 العودة إلى القائمة الرئيسية")
		.resized();
	const returnMessage = `هل ترغب في العودة إلى القائمة الرئيسية؟`;
	await ctx.reply(returnMessage, {
		reply_markup: mainMenu,
	});
});
bot.hears("من الجنية إلي عملة أخرى", async (ctx) => {
	// the user will be asked to enter the amount in EGP, and the bot will convert it to all other currencies
	const message = `من فضلك أدخل المبلغ الذي ترغب في تحويله من الجنية إلى العملات الأخرى بهذه الطريقة في المثال:
	4324 EGP`;
	await ctx.reply(message);
});
bot.hears("من عملة أخرى إلي الجنية", async (ctx) => {
	// the user will be asked to enter the amount in another currency, and the bot will convert it to EGP
	const message = `من فضلك أدخل المبلغ الذي ترغب في تحويله من العملات الأخرى إلى الجنية بهذه الطريقة في المثال:
	123 USD
	123 EUR
	123 SAR
	123 AED
	123 KWD
	123 GBP`;
	await ctx.reply(message);
});

bot.hears("💵 أسعار العملات في البنك", async (ctx) => {
	const lastPrices = await blackMarketPrices();
	if (lastPrices) {
		const message = `أسعار العملات في البنك:
		
		الدولار الأمريكي (USD):
		شراء: ${lastPrices.bankPrice.USD.Buy || "N/A"}
		بيع: ${lastPrices.bankPrice.USD.Sell || "N/A"}
		
		اليورو (EUR):
		شراء: ${lastPrices.bankPrice.EUR.Buy || "N/A"}
		بيع: ${lastPrices.bankPrice.EUR.Sell || "N/A"}
		
		الجنيه الاسترليني (GBP):
		شراء: ${lastPrices.bankPrice.GBP.Buy || "N/A"}
		بيع: ${lastPrices.bankPrice.GBP.Sell || "N/A"}
		
		الريال السعودي (SAR):
		شراء: ${lastPrices.bankPrice.SAR.Buy || "N/A"}
		بيع: ${lastPrices.bankPrice.SAR.Sell || "N/A"}
		
		الدرهم الإماراتي (AED):
		شراء: ${lastPrices.bankPrice.AED.Buy || "N/A"}
		بيع: ${lastPrices.bankPrice.AED.Sell || "N/A"}
		
		الدينار الكويتي (KWD):
		شراء: ${lastPrices.bankPrice.KWD.Buy || "N/A"}
		بيع: ${lastPrices.bankPrice.KWD.Sell || "N/A"}
		
		آخر تحديث: ${lastPrices.lastUpdate || "N/A"}`;
		await ctx.reply(message);
	} else {
		await ctx.reply("تعذر إرسال الرسالة");
	}
});
bot.hears("💰 أسعار العملات في السوق السوداء", async (ctx) => {
	const lastPrices = await blackMarketPrices();
	if (lastPrices) {
		const message = `أسعار العملات في السوق السوداء:
		
		الدولار الأمريكي (USD):
		شراء: ${lastPrices.blackPrice.USD.Buy || "N/A"}
		بيع: ${lastPrices.blackPrice.USD.Sell || "N/A"}
		
		اليورو (EUR):
		شراء: ${lastPrices.blackPrice.EUR.Buy || "N/A"}
		بيع: ${lastPrices.blackPrice.EUR.Sell || "N/A"}
		
		الجنيه الاسترليني (GBP):
		شراء: ${lastPrices.blackPrice.GBP.Buy || "N/A"}
		بيع: ${lastPrices.blackPrice.GBP.Sell || "N/A"}
		
		الريال السعودي (SAR):
		شراء: ${lastPrices.blackPrice.SAR.Buy || "N/A"}
		بيع: ${lastPrices.blackPrice.SAR.Sell || "N/A"}
		
		الدرهم الإماراتي (AED):
		شراء: ${lastPrices.blackPrice.AED.Buy || "N/A"}
		بيع: ${lastPrices.blackPrice.AED.Sell || "N/A"}
		
		الدينار الكويتي (KWD):
		شراء: ${lastPrices.blackPrice.KWD.Buy || "N/A"}
		بيع: ${lastPrices.blackPrice.KWD.Sell || "N/A"}
		
		آخر تحديث: ${lastPrices.lastUpdate || "N/A"}`;
		await ctx.reply(message);
	} else {
		await ctx.reply("تعذر إرسال الرسالة");
	}
});
bot.hears("الدولار الأمريكي (USD)", async (ctx) => {
	const lastPrices = await blackMarketPrices();
	if (lastPrices) {
		const message = `أسعار الدولار الأمريكي:
		
		في البنك:
		شراء: ${lastPrices.bankPrice.USD.Buy || "N/A"}
		بيع: ${lastPrices.bankPrice.USD.Sell || "N/A"}
		
		في السوق السوداء:
		شراء: ${lastPrices.blackPrice.USD.Buy || "N/A"}
		بيع: ${lastPrices.blackPrice.USD.Sell || "N/A"}`;
		await ctx.reply(message);
	} else {
		await ctx.reply("تعذر إرسال الرسالة");
	}
});
bot.hears("اليورو (EUR)", async (ctx) => {
	const lastPrices = await blackMarketPrices();
	if (lastPrices) {
		const message = `أسعار اليورو:
		
		في البنك:
		شراء: ${lastPrices.bankPrice.EUR.Buy || "N/A"}
		بيع: ${lastPrices.bankPrice.EUR.Sell || "N/A"}
		
		في السوق السوداء:
		شراء: ${lastPrices.blackPrice.EUR.Buy || "N/A"}
		بيع: ${lastPrices.blackPrice.EUR.Sell || "N/A"}`;
		await ctx.reply(message);
	} else {
		await ctx.reply("تعذر إرسال الرسالة");
	}
});
bot.hears("الجنيه الاسترليني (GBP)", async (ctx) => {
	const lastPrices = await blackMarketPrices();
	if (lastPrices) {
		const message = `أسعار الجنيه الاسترليني:
		
		في البنك:
		شراء: ${lastPrices.bankPrice.GBP.Buy || "N/A"}
		بيع: ${lastPrices.bankPrice.GBP.Sell || "N/A"}
		
		في السوق السوداء:
		شراء: ${lastPrices.blackPrice.GBP.Buy || "N/A"}
		بيع: ${lastPrices.blackPrice.GBP.Sell || "N/A"}`;
		await ctx.reply(message);
	} else {
		await ctx.reply("تعذر إرسال الرسالة");
	}
});
bot.hears("الريال السعودي (SAR)", async (ctx) => {
	const lastPrices = await blackMarketPrices();
	if (lastPrices) {
		const message = `أسعار الريال السعودي:
		
		في البنك:
		شراء: ${lastPrices.bankPrice.SAR.Buy || "N/A"}
		بيع: ${lastPrices.bankPrice.SAR.Sell || "N/A"}
		
		في السوق السوداء:
		شراء: ${lastPrices.blackPrice.SAR.Buy || "N/A"}
		بيع: ${lastPrices.blackPrice.SAR.Sell || "N/A"}`;
		await ctx.reply(message);
	} else {
		await ctx.reply("تعذر إرسال الرسالة");
	}
});
bot.hears("الدرهم الإماراتي (AED)", async (ctx) => {
	const lastPrices = await blackMarketPrices();
	if (lastPrices) {
		const message = `أسعار الدرهم الإماراتي:
		
		في البنك:
		شراء: ${lastPrices.bankPrice.AED.Buy || "N/A"}
		بيع: ${lastPrices.bankPrice.AED.Sell || "N/A"}
		
		في السوق السوداء:
		شراء: ${lastPrices.blackPrice.AED.Buy || "N/A"}
		بيع: ${lastPrices.blackPrice.AED.Sell || "N/A"}`;
		await ctx.reply(message);
	} else {
		await ctx.reply("تعذر إرسال الرسالة");
	}
});
bot.hears("الدينار الكويتي (KWD)", async (ctx) => {
	const lastPrices = await blackMarketPrices();
	if (lastPrices) {
		const message = `أسعار الدينار الكويتي:
		
		في البنك:
		شراء: ${lastPrices.bankPrice.KWD.Buy || "N/A"}
		بيع: ${lastPrices.bankPrice.KWD.Sell || "N/A"}
		
		في السوق السوداء:
		شراء: ${lastPrices.blackPrice.KWD.Buy || "N/A"}
		بيع: ${lastPrices.blackPrice.KWD.Sell || "N/A"}`;
		await ctx.reply(message);
	} else {
		await ctx.reply("تعذر إرسال الرسالة");
	}
});

bot.hears("🔙 العودة إلى القائمة الرئيسية", async (ctx) => {
	const mainMenu = new Keyboard()
		.text("ملخص لجميع العملات 📈💰")
		.row()
		.text("سعر عملة محددة 💱")
		.row()
		.text("🏅 أسعار الذهب")
		.text("تحويل العملات 🔄")
		.row()
		.text("معلومات ℹ️")
		.resized()
		.oneTime();
	const message = `ماذا ترغب في القيام به الآن؟`;
	await ctx.reply(message, {
		reply_markup: mainMenu,
	});
});
bot.on(":text", async (ctx) => {
	let text = ctx.message.text;
	text = text.toUpperCase();
	if (text.includes("EGP")) {
		// from EGP to other currencies
		const amount = text.split(" ")[0];
		const lastPrices = await blackMarketPrices();
		if (lastPrices) {
			let message = `المبلغ المحول: ${amount} EGP`;
			const currencies = ["USD", "EUR", "GBP", "SAR", "AED", "KWD"];
			const bankPrices = lastPrices.bankPrice;
			const blackPrices = lastPrices.blackPrice;
			currencies.forEach((currency) => {
				message += `
				${currency}:
				بالبنك: ${(amount / bankPrices[currency].Sell).toFixed(2)}
				في السوق السوداء: ${(amount / blackPrices[currency].Sell).toFixed(2)}`;
			});
			await ctx.reply(message);
		} else {
			await ctx.reply("تعذر إرسال الرسالة");
		}
	} else if (
		text.includes("USD") ||
		text.includes("EUR") ||
		text.includes("GBP") ||
		text.includes("SAR") ||
		text.includes("AED") ||
		text.includes("KWD")
	) {
		// from other currencies to EGP
		const currency = text.split(" ")[1];
		const amount = text.split(" ")[0];
		const lastPrices = await blackMarketPrices();
		if (lastPrices) {
			let message = `المبلغ المحول: ${amount} ${currency}`;
			const bankPrices = lastPrices.bankPrice;
			const blackPrices = lastPrices.blackPrice;
			message += `
			بالبنك: ${(amount * bankPrices[currency].Buy).toFixed(2)} EGP
			في السوق السوداء: ${(amount * blackPrices[currency].Buy).toFixed(2)} EGP`;
			await ctx.reply(message);
		} else {
			await ctx.reply("تعذر إرسال الرسالة");
		}
	} else {
		await ctx.reply("عذرًا، لم أتمكن من فهم طلبك");
	}
	const mainMenu = new Keyboard()
		.text(`من الجنية إلي عملة أخرى`)
		.row()
		.text(`من عملة أخرى إلي الجنية`)
		.row()
		.text("🔙 العودة إلى القائمة الرئيسية")
		.resized();
	const message = `ماذا ترغب في القيام به الآن؟`;
	await ctx.reply(message, {
		reply_markup: mainMenu,
	});
});
// bot.start();
addEventListener("fetch", webhookCallback(bot, "cloudflare"));

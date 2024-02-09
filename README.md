<div align="center">
<a href="https://techforpalestine.org/learn-more">
  <img src="https://raw.githubusercontent.com/Safouene1/support-palestine-banner/master/StandWithPalestine.svg" alt="StandWithPalestine">
</a>

<a align="center" href="https://hits.sh/github.com/AhmedMohamedAbdelaty/EGP-BlackMarket-TelegramBot/"><img alt="Hits" src="https://hits.sh/github.com/AhmedMohamedAbdelaty/EGP-BlackMarket-TelegramBot.svg?style=for-the-badge&label=Views"/></a>
</div>

## EGP Exchange Rate in the Black Market Bot

EGP Exchange Bot is a Telegram bot that scrapes the black market price of the Egyptian Pound (EGP) and sends it to the user. The bot was originally written in Java and used the Telegram Bot API and Jsoup for web scraping. However, due to deployment limitations on Glitch, the bot was rewritten in JavaScript using the Grammy library and deployed on Cloudflare Workers.

## Project Structure

The project consists of the following main files:

- `EGPBot.java`: This is the main bot class that extends `TelegramLongPollingBot`. It handles updates received from users and sends back the scraped EGP price.

- `Main.java`: This is the entry point of the application. It registers the bot to the Telegram Bot API.

- `pom.xml`: This is the Maven Project Object Model file. It contains the project and configuration details used by Maven to build the project.

- `start.sh`: This is a shell script that compiles the Java files and runs the main class (needed for Glitch).

- `glitch.json`: This file is used by the Glitch platform to install and start the bot.

## JavaScript Version

Due to limitations with the Glitch platform, the bot was rewritten in JavaScript using the Grammy library and deployed on Cloudflare Workers. The bot should work 24/7 and the code is as follows:

```javascript
import { Bot, webhookCallback } from "grammy";
const cheerio = require("cheerio");

const BOT_TOKEN = "YOUR_BOT_TOKEN";

const bot = new Bot(BOT_TOKEN);

bot.on("message", async (ctx) => {
  try {
    const response = await fetch(
      "https://xrate.me/en/currency/usd-to-egp/black"
    );
    const body = await response.text();
    const $ = cheerio.load(body);

    const Buy = $(".fw-bolder.margin-me-4").text();
    const Sell = $(".mx-1.text-black").text();

    await ctx.reply(`سعر الدولار في السوق السوداء\n
    شراء: ${Buy} جنية \n
    بيع: ${Sell} جنية \n
    ّ`);
  } catch (error) {
    console.error(error);
    await ctx.reply("Could not retrieve the data");
  }
});

addEventListener("fetch", webhookCallback(bot, "cloudflare"));
```

You can find the deployment guide [here](https://grammy.dev/hosting/cloudflare-workers-nodejs).

## Deployment

The bot is deployed on the Cloudflare Workers platform. You can interact with it using this link: [EGP Exchange Bot](https://t.me/EGP_Exchange_Bot)

## Usage

Currently, the bot sends the price of EGP when the user sends anything to the bot.

## Demo

https://github.com/AhmedMohamedAbdelaty/EGPBot/assets/73834838/45cfcf0b-391f-4681-ade7-825b782e6c15

## Future Work

- Add support for other currencies.
- Add commands to the bot for better interaction.

## Reflections and Learning
Currently, the bot is functioning as expected, even though the deployment project isn't in Java. This doesn't concern me, as the primary purpose of this project was to satisfy my curiosity about how Telegram bots are created and deployed. It has been a significant learning experience for me.

## Contributing

Contributions are welcome. Please feel free to submit a pull request or open an issue.

## Acknowledgements

- [Telegram Bot API](https://core.telegram.org/bots/api)
- [Jsoup](https://jsoup.org/)
- [Glitch](https://glitch.com/)
- [Grammy](https://grammy.dev/)
- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
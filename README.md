## EGP Exchange Rate in the Black Market Bot

EGP Exchange Bot is a Telegram bot that scrapes the black market price of the Egyptian Pound (EGP) and sends it to the user. The bot is written in Java and uses the Telegram Bot API and Jsoup for web scraping.

## Project Structure

The project consists of the following main files:

- `EGPBot.java`: This is the main bot class that extends `TelegramLongPollingBot`. It handles updates received from users and sends back the scraped EGP price.

- `Main.java`: This is the entry point of the application. It registers the bot to the Telegram Bot API.

- `pom.xml`: This is the Maven Project Object Model file. It contains the project and configuration details used by Maven to build the project.

- `start.sh`: This is a shell script that compiles the Java files and runs the main class (needed for Glitch).

- `glitch.json`: This file is used by the Glitch platform to install and start the bot.

## Deployment

The bot is deployed on the Glitch platform. You can interact with it using this link: [EGP Exchange Bot](https://t.me/EGP_Exchange_Bot)

## Usage

Currently, the bot sends the price of EGP when the user sends anything to the bot.

## Demo

<video align="center" width="100%" controls>
    <source src="screenshot/screenshot.mp4" type="video/mp4">
</video>

## Future Work

- Add support for other currencies.
- Add commands to the bot for better interaction.

## Contributing

Contributions are welcome. Please feel free to submit a pull request or open an issue.

## Acknowledgements

- [Telegram Bot API](https://core.telegram.org/bots/api)
- [Jsoup](https://jsoup.org/)
- [Glitch](https://glitch.com/)

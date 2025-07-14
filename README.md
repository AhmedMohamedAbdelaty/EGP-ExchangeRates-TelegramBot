# EGP Exchange Rates Telegram Bot 🇪🇬💱

[![Deno](https://img.shields.io/badge/deno-v1.40+-black?logo=deno)](https://deno.land/)
[![TypeScript](https://img.shields.io/badge/typescript-4.9+-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Grammy](https://img.shields.io/badge/grammy-v1.36+-green)](https://grammy.dev/)

A modern Telegram bot for checking Egyptian Pound (EGP) exchange rates, fuel prices, and gold prices. Built with **Deno** and **TypeScript** for better performance, security, and developer experience.

## ✨ Features

- 💱 **Real-time Exchange Rates**: USD, EUR, GBP, SAR and more currencies to EGP
- ⛽ **Fuel Prices**: Current fuel prices in Egypt
- 🥇 **Gold Prices**: Live gold prices in Egyptian market
- 🔄 **Currency Conversion**: Convert between different currencies
- 🎛️ **Admin Panel**: Web-based admin interface for bot management
- 📊 **Multiple Sources**: Aggregates data from reliable financial sources
- ⚡ **Fast & Secure**: Built with Deno for enhanced security and performance

## 🚀 Quick Start

### Prerequisites

- [Deno](https://deno.land/) v1.40 or higher
- A Telegram Bot Token from [@BotFather](https://t.me/botfather)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/AhmedMohamedAbdelaty/EGP-ExchangeRates-TelegramBot.git
   cd EGP-ExchangeRates-TelegramBot
   ```

2. **Set up environment variables**
   ```bash
   # Create .env file
   cp .env.example .env

   # Edit .env with your configuration
   TELEGRAM_BOT_TOKEN=your_bot_token_here
   ADMIN_SECRET=your_admin_secret_here
   ```

3. **Run the bot**
   ```bash
   # Development mode with polling
   deno task dev

   # Production mode with webhooks
   deno task start
   ```

## 🛠️ Configuration

The bot supports both **polling** and **webhook** modes:

- **Polling** (`poll.ts`): For development and testing
- **Webhook** (`server.ts`): For production deployment

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `TELEGRAM_BOT_TOKEN` | Your Telegram bot token | ✅ |
| `ADMIN_SECRET` | Secret key for admin panel access | ✅ |
| `WEBHOOK_URL` | Webhook URL for production | ⚠️ (webhook mode) |
| `PORT` | Server port (default: 3000) | ❌ |

## 📁 Project Structure

```
├── bot.ts                 # Main bot logic and handlers
├── config.ts             # Configuration management
├── server.ts             # Webhook server (production)
├── poll.ts               # Polling server (development)
├── admin_server.ts       # Admin panel server
├── handlers/             # Command and callback handlers
│   ├── commands.ts       # Bot commands
│   ├── conversion.ts     # Currency conversion logic
│   ├── currency.ts       # Exchange rates
│   ├── fuel.ts          # Fuel prices
│   └── gold.ts          # Gold prices
├── services/            # External API services
│   └── api.ts          # API clients and data fetching
├── keyboards/           # Telegram inline keyboards
│   └── index.ts        # Keyboard definitions
└── deps.*.ts           # Dependency management
```

## 🎯 Available Commands

| Command | Description |
|---------|-------------|
| `/start` | Initialize the bot and show welcome message |
| `/help` | Display help information |
| `/rates` | Show current exchange rates |
| `/convert` | Start currency conversion |
| `/fuel` | Get current fuel prices |
| `/gold` | Check gold prices |

## 🔧 Deployment

### Deno Deploy

1. Fork this repository
2. Connect your GitHub account to [Deno Deploy](https://dash.deno.com/)
3. Create a new project and link your repository
4. Set environment variables in the project settings
5. Deploy with the `server.ts` entry point

### Docker

```dockerfile
FROM denoland/deno:latest

WORKDIR /app
COPY . .
RUN deno cache server.ts

EXPOSE 3000
CMD ["deno", "run", "--allow-net", "--allow-read", "--allow-env", "--allow-write", "--unstable-kv", "server.ts"]
```

### Other Platforms

The bot can be deployed on any platform that supports Deno:
- Railway
- Fly.io
- Heroku (with Deno buildpack)
- VPS with Deno runtime

## 🔄 Migration Notice

> **Note**: This repository was previously a JavaScript/Cloudflare Workers implementation. The original code has been preserved in the [`legacy-cloudflare-workers`](https://github.com/AhmedMohamedAbdelaty/EGP-ExchangeRates-TelegramBot/tree/legacy-cloudflare-workers) branch. The current version is a complete rewrite using Deno and TypeScript for better maintainability and performance.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Grammy](https://grammy.dev/) - The Telegram Bot Framework for Deno
- [Deno](https://deno.land/) - A secure runtime for JavaScript and TypeScript
- Exchange rate data providers and financial APIs

---

⭐ If you find this project useful, please consider giving it a star!

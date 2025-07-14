import { bot } from "./bot.ts";

console.log("Starting bot in polling mode...");

// Delete any existing webhook before starting polling
await bot.api.deleteWebhook();

bot.start();

console.log("Bot is running in polling mode. Press Ctrl+C to stop.");

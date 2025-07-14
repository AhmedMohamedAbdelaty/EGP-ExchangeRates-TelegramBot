import { load } from "./deps.deno.ts";

await load({ export: true });

const BOT_TOKEN_FROM_ENV = Deno.env.get("BOT_TOKEN");

if (!BOT_TOKEN_FROM_ENV) {
    console.error("CRITICAL: BOT_TOKEN is not defined in environment variables. Please set it in your .env file.");
    console.warn("Warning: BOT_TOKEN not found in .env, relying on hardcoded fallback if present. THIS IS NOT RECOMMENDED FOR PRODUCTION.");
}

export const config = {
    BOT_TOKEN: BOT_TOKEN_FROM_ENV,

    // API URLs
    API_URLS: {
        FOREXFY_EG: "https://forexfy.app/en/country/eg",
        SARF_TODAY_CURRENCY_EXCHANGE: "https://sarf-today.com/en",
    },

    BANK_NAMES: {
        FOREXFY_APP: "forexfy.app",
    },

    // Currency codes
    CURRENCIES: ["USD", "EUR", "GBP", "SAR", "AED", "KWD"],

    // Gold karats
    GOLD_TYPES: {
        "24k": "24 Karat",
        "21k": "21 Karat",
        "18k": "18 Karat",
        "22k": "22 Karat",
        "Gold Ounce": "Gold Ounce",
        "Gold Pound(Coin)": "Gold Coin",
        "14k": "14 Karat",
        "12k": "12 Karat",
        "9k": "9 Karat",
    },

    TIMEZONE: "Africa/Cairo",

    FUEL_TYPES: [
        "Octane 80",
        "Octane 90",
        "Octane 95",
    ],
};

import { config as loadDotenv } from "npm:dotenv@16.6.1";
import { config as appConfig } from "./app_config.ts";

loadDotenv({ override: false });

export const config = {
    ...appConfig,
    BOT_TOKEN: Deno.env.get("BOT_TOKEN"),
    WEBHOOK_SECRET: Deno.env.get("WEBHOOK_SECRET"),
    ADMIN_DASHBOARD_TOKEN: Deno.env.get("ADMIN_DASHBOARD_TOKEN"),
};

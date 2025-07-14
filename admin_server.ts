import { STATUS_CODE } from "https://deno.land/std@0.224.0/http/status.ts";
import { config } from "./config.ts";

const kv = await Deno.openKv();

const KV_ANALYTICS_DAILY_INTERACTIONS_PREFIX = ["analytics", "daily_interactions"];
const KV_ANALYTICS_COMMAND_USAGE_PREFIX = ["analytics", "command_usage"];

const ADMIN_USER_IDS = (() => {
    const envValue = Deno.env.get("ADMIN_USER_IDS");
    if (!envValue?.trim()) return [];

    return envValue.split(',')
        .map(id => {
            const parsed = parseInt(id.trim(), 10);
            if (isNaN(parsed)) {
                console.warn(`Invalid admin user ID: ${id.trim()}`);
                return null;
            }
            return parsed;
        })
        .filter((id): id is number => id !== null);
})();


async function getAnalyticsData() {
    const dailyInteractions = new Map<string, number>();
    const commandUsage = new Map<string, number>();

    for await (const entry of kv.list({ prefix: KV_ANALYTICS_DAILY_INTERACTIONS_PREFIX })) {
        if (entry.key.length === KV_ANALYTICS_DAILY_INTERACTIONS_PREFIX.length + 1 && typeof entry.key[KV_ANALYTICS_DAILY_INTERACTIONS_PREFIX.length] === 'string') {
            const date = entry.key[KV_ANALYTICS_DAILY_INTERACTIONS_PREFIX.length] as string;
            dailyInteractions.set(date, Number(entry.value as Deno.KvU64));
        }
    }

    for await (const entry of kv.list({ prefix: KV_ANALYTICS_COMMAND_USAGE_PREFIX })) {
        if (entry.key.length === KV_ANALYTICS_COMMAND_USAGE_PREFIX.length + 1 && typeof entry.key[KV_ANALYTICS_COMMAND_USAGE_PREFIX.length] === 'string') {
            const commandName = entry.key[KV_ANALYTICS_COMMAND_USAGE_PREFIX.length] as string;
            commandUsage.set(commandName, Number(entry.value as Deno.KvU64));
        }
    }

    // Sort data for display
    const sortedDailyInteractions = new Map([...dailyInteractions.entries()].sort().reverse());
    const sortedCommandUsage = new Map([...commandUsage.entries()].sort((a, b) => b[1] - a[1]));


    return {
        dailyInteractions: sortedDailyInteractions,
        commandUsage: sortedCommandUsage,
    };
}

function renderAdminDashboard(data: { dailyInteractions: Map<string, number>; commandUsage: Map<string, number> }): string {
    let dailyInteractionsHtml = "";
    if (data.dailyInteractions.size > 0) {
        for (const [date, count] of data.dailyInteractions) {
            dailyInteractionsHtml += `<li>${date}: ${count} interactions</li>`;
        }
    } else {
        dailyInteractionsHtml = "<li>No daily interaction data yet.</li>";
    }

    let commandUsageHtml = "";
    if (data.commandUsage.size > 0) {
        for (const [command, count] of data.commandUsage) {
            commandUsageHtml += `<li>/${command}: ${count} uses</li>`;
        }
    } else {
        commandUsageHtml = "<li>No command usage data yet.</li>";
    }

    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Bot Admin Dashboard</title>
            <style>
                body { font-family: sans-serif; margin: 20px; background-color: #f4f4f4; color: #333; }
                .container { background-color: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 0 10px rgba(0,0,0,0.1); }
                h1 { color: #333; border-bottom: 2px solid #eee; padding-bottom: 10px; }
                h2 { color: #555; margin-top: 30px; }
                ul { list-style-type: none; padding-left: 0; }
                li { background-color: #e9e9e9; margin-bottom: 8px; padding: 10px; border-radius: 4px; }
                p { margin-top: 30px; font-size: 0.9em; color: #777; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>Bot Admin Dashboard</h1>

                <h2>Daily Interactions</h2>
                <ul>${dailyInteractionsHtml}</ul>

                <h2>Command Usage</h2>
                <ul>${commandUsageHtml}</ul>

                <p>Note: All data is aggregated and anonymized to protect user privacy.</p>
                <p>Admin User IDs: ${ADMIN_USER_IDS.join(', ') || 'Not configured'}</p>
            </div>
        </body>
        </html>
    `;
}

export async function handleAdminRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (req.method !== "GET") {
        return new Response("Method Not Allowed", { status: STATUS_CODE.MethodNotAllowed });
    }

    try {
        const analyticsData = await getAnalyticsData();
        const html = renderAdminDashboard(analyticsData);
        return new Response(html, {
            status: STATUS_CODE.OK,
            headers: { "Content-Type": "text/html; charset=utf-8" },
        });
    } catch (error) {
        console.error("Error generating admin dashboard:", error);
        return new Response("Internal Server Error", { status: STATUS_CODE.InternalServerError });
    }
}

import { serve } from "https://deno.land/std@0.220.1/http/server.ts";
import { webhookCallback } from "./deps.deno.ts";
import { bot } from "./bot.ts";
import { config } from "./config.ts";
import { handleAdminRequest } from "./admin_server.ts";

async function setupWebhook() {
    if (!config.BOT_TOKEN) {
        console.error("CRITICAL: BOT_TOKEN is not defined. Webhook setup cannot proceed.");
        return;
    }

    const deploymentId = Deno.env.get("DENO_DEPLOYMENT_ID");

    if (!deploymentId) {
        console.warn("DENO_DEPLOYMENT_ID not found. Skipping webhook setup. This is expected for local development (use poll.ts).");
        return;
    }

    const baseUrl = `https://price-bot-${deploymentId}.deno.dev`;
    console.log(`Using deployment-specific base URL: ${baseUrl}`);

    const webhookUrl = `${baseUrl}/${config.BOT_TOKEN}`;

    try {
        await bot.api.setWebhook(webhookUrl);
        console.log(`Webhook successfully set to: ${webhookUrl}`);
    } catch (error) {
        console.error("CRITICAL: Failed to set webhook:", error);
    }
}

await setupWebhook();

const handleUpdate = webhookCallback(bot, "std/http");

const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Telegram Bot Tester</title>
  <style>
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
      line-height: 1.6;
    }
    h1 {
      color: #0088cc;
      text-align: center;
    }
    form {
      background: #f5f5f5;
      padding: 20px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    label {
      display: block;
      margin-bottom: 5px;
      font-weight: bold;
    }
    input[type="text"] {
      width: 100%;
      padding: 8px;
      margin-bottom: 15px;
      border: 1px solid #ddd;
      border-radius: 4px;
    }
    button {
      background: #0088cc;
      color: white;
      border: none;
      padding: 10px 15px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 16px;
    }
    button:hover {
      background: #006699;
    }
    #response {
      margin-top: 20px;
      padding: 15px;
      border-radius: 4px;
      display: none;
    }
    .success {
      background: #d4edda;
      border: 1px solid #c3e6cb;
      color: #155724;
    }
    .error {
      background: #f8d7da;
      border: 1px solid #f5c6cb;
      color: #721c24;
    }
  </style>
</head>
<body>
  <h1>Telegram Bot Tester</h1>
  <form id="botForm">
    <label for="chatId">Chat ID:</label>
    <input type="text" id="chatId" name="chatId" required placeholder="Enter your Telegram chat ID">
    <br>
    <label for="message">Message:</label>
    <input type="text" id="message" name="message" required placeholder="Enter message to send">
    <br>
    <button type="submit">Send Message</button>
  </form>
  <div id="response"></div>

  <script>
    document.getElementById('botForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const chatId = document.getElementById('chatId').value;
      const message = document.getElementById('message').value;
      const responseDiv = document.getElementById('response');

      try {
        const response = await fetch('/send-message', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ chatId, message }),
        });

        const result = await response.json();
        responseDiv.textContent = result.status;
        responseDiv.className = response.ok ? 'success' : 'error';
        responseDiv.style.display = 'block';
      } catch (error) {
        responseDiv.textContent = 'Error: ' + error.message;
        responseDiv.className = 'error';
        responseDiv.style.display = 'block';
      }
    });
  </script>
</body>
</html>
`;

serve(async (req) => {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/") {
        return new Response(html, {
            headers: { "Content-Type": "text/html" },
        });
    }

    if (req.method === "GET" && url.pathname === "/admin") {
        try {
            return await handleAdminRequest(req);
        } catch (err) {
            console.error("Error serving admin dashboard:", err);
            return new Response("Error serving admin dashboard", { status: 500 });
        }
    }

    if (req.method === "POST" && url.pathname === "/send-message") {
        try {
            const { chatId, message } = await req.json();
            await bot.api.sendMessage(chatId, message);
            return new Response(
                JSON.stringify({ status: "Message sent successfully!" }),
                {
                    headers: { "Content-Type": "application/json" },
                }
            );
        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : "Unknown error";
            console.error("Error sending message:", errorMessage);
            return new Response(
                JSON.stringify({
                    status: "Failed to send message.",
                    error: errorMessage
                }),
                {
                    status: 500,
                    headers: { "Content-Type": "application/json" },
                }
            );
        }
    }

    if (req.method === "POST") {
        // The webhook path is the bot token
        if (config.BOT_TOKEN && url.pathname.slice(1) === config.BOT_TOKEN) {
            try {
                return await handleUpdate(req);
            } catch (err) {
                console.error("Error processing update:", err);
                return new Response("Error processing update", { status: 500 });
            }
        }
    }

    return new Response("Not Found", { status: 404 });
}, { port: 8000 });

console.log("Server is running on http://localhost:8000");

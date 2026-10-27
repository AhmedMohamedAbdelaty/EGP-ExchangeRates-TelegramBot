#!/usr/bin/env python3
"""Register only the known test bot's webhook, using its private local secrets file."""
import json
import os
from pathlib import Path
import urllib.error
import urllib.request

SECRETS = Path("/home/ahmed/.config/egp-exchange-bot/deno-test.env")
URL = "https://egp-exchange-test.ahmedmohamedabdelaty.deno.net/webhook"
USERNAME = "randombot_test_bot"


def api(token, method, data=None):
    payload = None if data is None else json.dumps(data).encode()
    headers = {} if data is None else {"Content-Type": "application/json"}
    request = urllib.request.Request(f"https://api.telegram.org/bot{token}/{method}", data=payload, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            body = json.load(response)
    except (urllib.error.URLError, OSError, ValueError):
        raise RuntimeError(f"Telegram {method} failed") from None
    if not body.get("ok"):
        raise RuntimeError(f"Telegram {method} failed")
    return body["result"]


def register(token, secret):
    if api(token, "getMe").get("username") != USERNAME:
        raise RuntimeError("Refusing to change a bot other than the test bot")
    before = api(token, "getWebhookInfo")
    if before.get("url") not in ("", URL):
        raise RuntimeError("Refusing to replace a different webhook")
    api(token, "setWebhook", {
        "url": URL, "secret_token": secret, "max_connections": 1,
        "allowed_updates": ["message", "callback_query"],
    })
    after = api(token, "getWebhookInfo")
    if after.get("url") != URL:
        raise RuntimeError("Webhook readback did not match")
    return after.get("pending_update_count")


def main():
    if SECRETS.is_symlink() or SECRETS.stat().st_uid != os.getuid() or SECRETS.stat().st_mode & 0o077:
        raise RuntimeError("Test secrets must be an owner-only file")
    values = dict(line.split("=", 1) for line in SECRETS.read_text().splitlines() if "=" in line)
    token, secret = values.get("BOT_TOKEN", ""), values.get("WEBHOOK_SECRET", "")
    if not token or not secret:
        raise RuntimeError("Test token or webhook secret is missing")
    count = register(token, secret)
    print(f"Test webhook registered; pending updates: {count}")


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError) as error:
        raise SystemExit(str(error)) from None

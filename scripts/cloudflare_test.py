#!/usr/bin/env python3
"""Operate the Cloudflare test bot without printing credentials."""
import argparse
import json
import os
from html.parser import HTMLParser
from pathlib import Path
import stat
import urllib.error
import urllib.request

USERNAME = "randombot_test_bot"
BASE_URL = "https://egp-exchange-cloudflare-test.am0103738.workers.dev"
WEBHOOK_URL = BASE_URL + "/webhook"
OLD_WEBHOOK_URL = "https://egp-exchange-test.ahmedmohamedabdelaty.deno.net/webhook"
DEFAULT_SECRETS = "/home/ahmed/.config/egp-exchange-bot/cloudflare-test.env"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


OPENER = urllib.request.build_opener(NoRedirect())


def read_secrets():
    path = Path(os.environ.get("CLOUDFLARE_TEST_ENV", DEFAULT_SECRETS))
    try:
        flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
        fd = os.open(path, flags)
        with os.fdopen(fd, "r", encoding="utf-8") as source:
            info = os.fstat(source.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
                raise RuntimeError("Test credentials must be an owner-only regular file")
            values = dict(line.strip().split("=", 1) for line in source if "=" in line and not line.lstrip().startswith("#"))
    except (OSError, UnicodeError, ValueError):
        raise RuntimeError("Could not read private test credentials") from None
    return values


def request(url, data=None, headers=None):
    try:
        req = urllib.request.Request(url, data=data, headers={"User-Agent": "curl/8.0 egp-exchange-test-operator/1.0", **(headers or {})})
        with OPENER.open(req, timeout=20) as response:
            return response.read()
    except (urllib.error.URLError, OSError, ValueError):
        raise RuntimeError("Test service request failed") from None


def api(token, method, data=None):
    payload = None if data is None else json.dumps(data).encode()
    headers = {} if data is None else {"Content-Type": "application/json"}
    try:
        body = json.loads(request(f"https://api.telegram.org/bot{token}/{method}", payload, headers))
        if not isinstance(body, dict) or body.get("ok") is not True or "result" not in body:
            raise ValueError
        return body["result"]
    except (ValueError, TypeError):
        raise RuntimeError(f"Telegram {method} failed") from None


def identity(token):
    result = api(token, "getMe")
    if not isinstance(result, dict) or result.get("username") != USERNAME:
        raise RuntimeError("Refusing to operate on a bot other than the test bot")


def webhook_kind(url):
    return {"": "unset", WEBHOOK_URL: "Cloudflare test", OLD_WEBHOOK_URL: "previous Deno test"}.get(url, "unknown") if isinstance(url, str) else "unknown"


def status(token):
    identity(token)
    info = api(token, "getWebhookInfo")
    if not isinstance(info, dict):
        raise RuntimeError("Could not read webhook status")
    count = info.get("pending_update_count")
    if not isinstance(count, int) or isinstance(count, bool) or count < 0:
        raise RuntimeError("Could not read pending update count")
    kind = webhook_kind(info.get("url"))
    print(f"Bot: {USERNAME}\nWebhook: {kind}\nPending updates: {count}")


def register(token, secret):
    identity(token)
    before = api(token, "getWebhookInfo")
    if not isinstance(before, dict) or before.get("url") not in ("", WEBHOOK_URL, OLD_WEBHOOK_URL):
        raise RuntimeError("Refusing to replace an unknown webhook")
    api(token, "setWebhook", {
        "url": WEBHOOK_URL,
        "secret_token": secret,
        "max_connections": 1,
        "allowed_updates": ["message", "callback_query"],
    })
    after = api(token, "getWebhookInfo")
    if not isinstance(after, dict) or after.get("url") != WEBHOOK_URL:
        raise RuntimeError("Webhook readback did not match")
    print("Cloudflare test webhook registered")


class DashboardText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.hidden = 0
        self.lines = []

    def handle_starttag(self, tag, attrs):
        if tag in ("style", "script"):
            self.hidden += 1

    def handle_endtag(self, tag):
        if tag in ("style", "script") and self.hidden:
            self.hidden -= 1

    def handle_data(self, data):
        if not self.hidden and data.strip():
            self.lines.append(data.strip())


def dashboard(secret, secrets):
    try:
        body = request(BASE_URL + "/admin", headers={"Authorization": "Bearer " + secret}).decode("utf-8")
    except UnicodeError:
        raise RuntimeError("Could not read the test dashboard") from None
    parser = DashboardText()
    parser.feed(body)
    output = "\n".join(parser.lines)
    for value in secrets.values():
        if value:
            output = output.replace(value, "[redacted]")
    print(output)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", nargs="?", choices=("status", "register", "dashboard"), default="status")
    command = parser.parse_args().command
    values = read_secrets()
    needed = {"status": ("BOT_TOKEN",), "register": ("BOT_TOKEN", "WEBHOOK_SECRET"), "dashboard": ("ADMIN_SECRET",)}[command]
    if any(not values.get(key) for key in needed):
        raise RuntimeError("Required test credentials are missing")
    if command == "status":
        status(values["BOT_TOKEN"])
    elif command == "register":
        register(values["BOT_TOKEN"], values["WEBHOOK_SECRET"])
    else:
        dashboard(values["ADMIN_SECRET"], values)


if __name__ == "__main__":
    try:
        main()
    except RuntimeError as error:
        raise SystemExit(str(error)) from None
    except OSError:
        raise SystemExit("Test operation failed; check credentials and service availability") from None

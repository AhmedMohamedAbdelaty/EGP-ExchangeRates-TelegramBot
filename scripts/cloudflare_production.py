#!/usr/bin/env python3
"""Inspect or operate the explicitly identified production bot."""
import argparse
from html.parser import HTMLParser
import http.client
import json
import os
from pathlib import Path
import re
import stat
import urllib.error
import urllib.request

USERNAME = "EGP_Exchange_Bot"
BASE_URL = "https://egp-exchange-production.am0103738.workers.dev"
WEBHOOK_URL = BASE_URL + "/webhook"
SECRETS = Path.home() / ".config/egp-exchange-bot/cloudflare-production.env"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


OPENER = urllib.request.build_opener(NoRedirect())


def read_secrets():
    try:
        directory = os.open(SECRETS.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            info = os.fstat(directory)
            if info.st_uid != os.getuid() or info.st_mode & 0o077:
                raise RuntimeError("Production credentials directory must be owner-only")
            fd = os.open(SECRETS.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
            with os.fdopen(fd, encoding="utf-8") as source:
                info = os.fstat(source.fileno())
                if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
                    raise RuntimeError("Production credentials must be an owner-only regular file")
                return dict(line.strip().split("=", 1) for line in source
                            if "=" in line and not line.lstrip().startswith("#"))
        finally:
            os.close(directory)
    except (OSError, UnicodeError, ValueError):
        raise RuntimeError("Could not read private production credentials") from None


def request(url, data=None, headers=None):
    try:
        req = urllib.request.Request(url, data=data, headers={
            "User-Agent": "egp-exchange-production-operator/1.0", **(headers or {})})
        with OPENER.open(req, timeout=20) as response:
            return response.read()
    except (urllib.error.URLError, OSError, ValueError):
        raise RuntimeError("Production service request failed") from None


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
        raise RuntimeError("Refusing to operate on a bot other than @EGP_Exchange_Bot")


def webhook_info(token):
    info = api(token, "getWebhookInfo")
    if not isinstance(info, dict) or not isinstance(info.get("url"), str):
        raise RuntimeError("Could not read webhook status")
    count = info.get("pending_update_count")
    if not isinstance(count, int) or isinstance(count, bool) or count < 0:
        raise RuntimeError("Could not read pending update count")
    return info


def status(token):
    identity(token)
    info = webhook_info(token)
    target = {"": "unset", WEBHOOK_URL: "production"}.get(info["url"], "unknown")
    print(f"Bot: @{USERNAME}\nWebhook: {target}\nPending updates: {info['pending_update_count']}")


def preflight(secret):
    req = urllib.request.Request(WEBHOOK_URL, data=b"{", headers={
        "Content-Type": "application/json",
        "X-Telegram-Bot-Api-Secret-Token": secret,
        "User-Agent": "egp-exchange-production-operator/1.0",
    })
    try:
        try:
            response = OPENER.open(req, timeout=20)
        except urllib.error.HTTPError as response:
            with response:
                if response.code == 400 and response.read(128) == b"Invalid request":
                    return
        else:
            response.close()
    except (OSError, ValueError, http.client.HTTPException):
        pass
    raise RuntimeError("Production webhook preflight failed") from None


def register(token, secret):
    identity(token)
    before = webhook_info(token)
    if before["url"] not in ("", WEBHOOK_URL):
        raise RuntimeError("Refusing to replace an unknown webhook")
    preflight(secret)
    result = api(token, "setWebhook", {
        "url": WEBHOOK_URL, "secret_token": secret, "max_connections": 1,
        "allowed_updates": ["message", "callback_query"],
    })
    if result is not True:
        raise RuntimeError("Telegram setWebhook failed")
    after = webhook_info(token)
    if after["url"] != WEBHOOK_URL:
        raise RuntimeError("Webhook readback did not match")
    print(f"Production webhook registered; pending updates: {after['pending_update_count']}")


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


def dashboard(token, secret, secrets):
    identity(token)
    try:
        body = request(BASE_URL + "/admin", headers={"Authorization": "Bearer " + secret}).decode("utf-8")
        parser = DashboardText()
        parser.feed(body)
    except (UnicodeError, ValueError):
        raise RuntimeError("Could not read the production dashboard") from None
    output = "\n".join(parser.lines)
    for value in sorted(secrets.values(), key=len, reverse=True):
        if value:
            output = output.replace(value, "[redacted]")
    print(output)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", nargs="?", choices=("status", "register", "dashboard"), default="status")
    command = parser.parse_args().command
    values = read_secrets()
    needed = {"status": ("BOT_TOKEN",), "register": ("BOT_TOKEN", "WEBHOOK_SECRET"),
              "dashboard": ("BOT_TOKEN", "ADMIN_SECRET")}[command]
    if any(not values.get(key) for key in needed):
        raise RuntimeError("Required production credentials are missing")
    if not re.fullmatch(r"[0-9]+:[A-Za-z0-9_-]+", values["BOT_TOKEN"]):
        raise RuntimeError("Invalid production bot token format")
    if command == "register" and not re.fullmatch(r"[A-Za-z0-9_-]{1,256}", values["WEBHOOK_SECRET"]):
        raise RuntimeError("Invalid production webhook secret format")
    if command == "status":
        status(values["BOT_TOKEN"])
    elif command == "register":
        register(values["BOT_TOKEN"], values["WEBHOOK_SECRET"])
    else:
        dashboard(values["BOT_TOKEN"], values["ADMIN_SECRET"], values)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError) as error:
        raise SystemExit(str(error) if isinstance(error, RuntimeError) else "Production operation failed") from None

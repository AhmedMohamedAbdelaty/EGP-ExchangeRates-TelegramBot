#!/usr/bin/env python3
"""Prompt for a bot token and call only Telegram getMe/getWebhookInfo."""
import getpass
import json
import re
import urllib.error
import urllib.parse
import urllib.request

token = getpass.getpass("Bot token (hidden): ")
if not re.fullmatch(r"\d+:[A-Za-z0-9_-]+", token):
    raise SystemExit("Invalid token format")
for method in ("getMe", "getWebhookInfo"):
    try:
        request = urllib.request.Request("https://api.telegram.org/bot" + token + "/" + method)
        # Refuse redirects so credentials stay with the explicitly chosen API host.
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, newurl):
                return None
        opener = urllib.request.build_opener(NoRedirect)
        with opener.open(request, timeout=15) as response:
            body = json.load(response)
        if method == "getWebhookInfo" and body.get("result", {}).get("url"):
            url = urllib.parse.urlsplit(body["result"]["url"])
            body["result"]["url"] = url.scheme + "://" + url.netloc + "/<redacted-path>"
        print(method, json.dumps(body, ensure_ascii=False).replace(token, "<redacted-token>"))
    except urllib.error.HTTPError as error:
        print(method, "HTTP", error.code)
    except (OSError, ValueError):
        print(method, "Request failed; details withheld to avoid printing the token URL")

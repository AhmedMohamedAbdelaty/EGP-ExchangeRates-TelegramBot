#!/usr/bin/env python3
"""Print the test app's protected dashboard without exposing its bearer token."""
from html.parser import HTMLParser
from pathlib import Path
import os
import urllib.error
import urllib.request

secrets = Path("/home/ahmed/.config/egp-exchange-bot/deno-test.env")
if secrets.is_symlink() or secrets.stat().st_uid != os.getuid() or secrets.stat().st_mode & 0o077:
    raise SystemExit("Test secrets must be an owner-only file")
values = dict(line.split("=", 1) for line in secrets.read_text().splitlines() if "=" in line)
token = values.get("ADMIN_DASHBOARD_TOKEN", "")
if not token:
    raise SystemExit("Admin token is missing")
request = urllib.request.Request(
    "https://egp-exchange-test.ahmedmohamedabdelaty.deno.net/admin",
    headers={"Authorization": "Bearer " + token},
)
try:
    with urllib.request.urlopen(request, timeout=20) as response:
        html = response.read().decode()
except (urllib.error.URLError, OSError):
    raise SystemExit("Could not read the test dashboard") from None


class Text(HTMLParser):
    def __init__(self):
        super().__init__()
        self.hidden = False

    def handle_starttag(self, tag, _attrs):
        if tag in ("style", "script"): self.hidden = True

    def handle_endtag(self, tag):
        if tag in ("style", "script"): self.hidden = False

    def handle_data(self, data):
        if not self.hidden and data.strip(): print(data.strip())


Text().feed(html)

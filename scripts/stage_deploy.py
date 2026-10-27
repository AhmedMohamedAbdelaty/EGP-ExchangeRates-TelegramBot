#!/usr/bin/env python3
"""Copy the application's runtime files to a private, secret-free deploy directory."""
from pathlib import Path
import hashlib
import shutil
import tempfile

root = Path(__file__).resolve().parents[1]
stage = Path(tempfile.mkdtemp(prefix="egp-bot-deploy-"))
files = [root / name for name in (
    "server.ts", "bot.ts", "config.ts", "admin_server.ts", "deps.deno.ts",
    "deps.cheerio.ts", "deno.json", "deno.lock",
)]
for folder in ("handlers", "services", "keyboards"):
    files.extend(path for path in (root / folder).glob("*.ts") if not path.name.endswith("_test.ts"))
for source in files:
    if not source.is_file() or source.is_symlink():
        raise SystemExit(f"Missing or symlinked source: {source.relative_to(root)}")
    destination = stage / source.relative_to(root)
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, destination)
    if hashlib.sha256(source.read_bytes()).digest() != hashlib.sha256(destination.read_bytes()).digest():
        raise SystemExit(f"Copy failed: {source.relative_to(root)}")
print(stage)

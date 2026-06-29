#!/usr/bin/env python3
"""
Mobile + tablet device preview via TRUE device emulation (Playwright).

Why this instead of the iframe harness (static/devices.html): the app's mobile
"fit-to-screen" zoom (the window.innerWidth<=720 paths) is built for a real
top-level device window. Inside a scaled iframe it misfires and renders
off-view — so the iframe harness can't show phone widths correctly. Playwright
opens each device in a REAL top-level browser context (real viewport +
device-pixel-ratio + mobile user-agent + touch), so it renders exactly like the
device. The iframe harness stays useful for tablet/desktop quick-looks.

Setup (one time — needs network):
    pip install playwright
    playwright install chromium

Usage:
    python scripts/device_screens.py                      # localhost:8000 /app, screenshots to ./screenshots
    python scripts/device_screens.py --url https://sivarr.com
    python scripts/device_screens.py --path /            # the landing/login instead of /app
    python scripts/device_screens.py --headed            # watch live; windows stay open until you press Enter
    python scripts/device_screens.py --devices "iPhone SE,iPad Mini"
    python scripts/device_screens.py --list              # print every device name Playwright knows
"""
import argparse
import sys
from pathlib import Path

# Default set — names must exist in Playwright's device registry (see --list).
DEFAULT_DEVICES = [
    "iPhone SE", "iPhone 12", "iPhone 14 Pro Max", "Pixel 7",
    "Galaxy S9+", "iPad Mini", "iPad (gen 7)", "iPad Pro 11",
]


def main() -> int:
    ap = argparse.ArgumentParser(description="Device-emulated screenshots for mobile/tablet QA")
    ap.add_argument("--url", default="http://localhost:8000", help="base URL of the running app")
    ap.add_argument("--path", default="/app", help="route to capture (e.g. /app, /)")
    ap.add_argument("--devices", default="", help="comma-separated device names (default: a phone+tablet set)")
    ap.add_argument("--headed", action="store_true", help="show live browser windows instead of headless screenshots")
    ap.add_argument("--wait", type=int, default=3500, help="ms to wait after load (lets the SPA hydrate)")
    ap.add_argument("--out", default="screenshots", help="output directory for PNGs")
    ap.add_argument("--list", action="store_true", help="list all known Playwright device names and exit")
    args = ap.parse_args()

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        sys.exit("Playwright not installed. Run:\n  pip install playwright\n  playwright install chromium")

    target = args.url.rstrip("/") + args.path
    wanted = [d.strip() for d in args.devices.split(",") if d.strip()] or DEFAULT_DEVICES
    outdir = Path(args.out)

    with sync_playwright() as p:
        if args.list:
            for name in sorted(p.devices):
                vp = p.devices[name]["viewport"]
                print(f"  {name:24} {vp['width']}x{vp['height']}")
            return 0

        outdir.mkdir(parents=True, exist_ok=True)
        browser = p.chromium.launch(headless=not args.headed)
        open_ctxs = []
        print(f"Target: {target}\n")
        for name in wanted:
            desc = p.devices.get(name)
            if not desc:
                print(f"  ! unknown device (see --list): {name}")
                continue
            ctx = browser.new_context(**desc)
            page = ctx.new_page()
            try:
                page.goto(target, wait_until="load", timeout=30000)
            except Exception as exc:
                print(f"  ! {name}: load failed — {exc}")
            page.wait_for_timeout(args.wait)
            vp = desc["viewport"]
            if args.headed:
                open_ctxs.append(ctx)  # keep window open
                print(f"  {name:20} {vp['width']}x{vp['height']}  (window open)")
            else:
                safe = name.replace(" ", "_").replace("(", "").replace(")", "").replace("+", "plus")
                shot = outdir / f"{safe}.png"
                page.screenshot(path=str(shot), full_page=True)
                print(f"  {name:20} {vp['width']}x{vp['height']}  ->  {shot}")
                ctx.close()

        if args.headed and open_ctxs:
            print("\nLive windows open. Press Enter to close them…")
            try:
                input()
            except EOFError:
                pass
        browser.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

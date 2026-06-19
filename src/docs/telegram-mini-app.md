# Telegram Mini App

How Office Hell ships as a Telegram Mini App, and how to deploy it.

## How the integration works

The game is the same Vite build everywhere. The only Telegram-specific code
is [src/platform/telegram.ts](../platform/telegram.ts), wired in once from
[src/main.ts](../main.ts) (`await initTelegram()` before Phaser is built).

It does nothing unless the page was launched from Telegram (detected
synchronously from the `tgWebApp*` URL-fragment params), so the itch /
portal / desktop builds are byte-for-byte unaffected — no extra request, no
SDK. When it *is* a Telegram launch it loads Telegram's official
`telegram-web-app.js` and:

- `disableVerticalSwipes()` — **the load-bearing call.** Telegram minimises
  the Mini App on a downward swipe and the player's core input is a vertical
  thumb drag; without this, dodging down keeps half-closing the app.
- `expand()` + `requestFullscreen()` + `lockOrientation('portrait')` —
  reclaim the screen (fullscreen/lock are Bot API 8.0+, version-guarded).
- header/background colour to match the game.
- re-emits a `resize` on `viewportChanged` so BootScene re-pins the canvas.

[BootScene](../scenes/BootScene.ts) skips its own browser-fullscreen request
when Telegram is active (`isTelegramActive()`), since Telegram owns fullscreen
inside its webview.

## Deploy (local, from this machine)

Host is **Cloudflare Pages**. We upload the locally-built `dist/` so the Git
LFS assets are already smudged (Cloudflare's git integration does not reliably
pull LFS).

```bash
npm run build                       # tsc && vite build  → dist/
npx wrangler login                  # one-time, opens browser OAuth
npx wrangler pages deploy dist --project-name=office-hell
```

First deploy creates the `office-hell` Pages project and prints the public
URL (`https://office-hell.pages.dev` or a deploy-specific subdomain). Use the
stable project URL for Telegram.

## Register the Mini App (BotFather, one-time)

1. Talk to [@BotFather](https://t.me/BotFather) → `/newbot` (or reuse an
   existing bot).
2. `/newapp` → pick the bot → supply title, description, a 640×360 photo, and
   the **Web App URL** = the Cloudflare Pages URL above.
3. BotFather returns a `t.me/<bot>/<app>` direct link — open it on a phone in
   the Telegram iOS and Android apps to test.

## Test on a real device (desktop Telegram won't show these)

- Vertical thumb-drag while dodging must **not** minimise the app
  (`disableVerticalSwipes`).
- Music starts on first tap (iOS only unlocks the AudioContext inside a real
  gesture — the "tap to continue" screen is that gesture).
- In fullscreen, Telegram's close/menu controls overlay the top; confirm the
  HUD clears them (handled by `env(safe-area-inset-top)` padding in
  index.html).

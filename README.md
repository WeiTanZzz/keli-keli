<p align="center">
  <img src="desktop/src-tauri/icons/512x512.png" alt="KeliKeli" width="128" />
</p>

<h1 align="center">KeliKeli</h1>

<p align="center">
  <a href="../../releases/latest">Download</a> ·
  <a href="#what-you-get">Features</a> ·
  <a href="#sync--integrations">Integrations</a> ·
  <a href="#privacy">Privacy</a> ·
  <a href="#settings-reference">Settings</a>
</p>

<p align="center">
  <a href="../../releases/latest"><img src="https://img.shields.io/github/v/release/WeiTanZzz/keli-keli" alt="Latest Release" /></a>
  <img src="https://img.shields.io/badge/macOS_12%2B_%C2%B7_Apple_Silicon_%26_Intel-black?logo=apple&logoColor=white" alt="macOS 12+ · Apple Silicon & Intel" />
  <img src="https://img.shields.io/github/license/WeiTanZzz/keli-keli" alt="License" />
</p>

## A tiny macOS app that makes your work visible ⌨️✨

**KeliKeli** floats a live indicator on your screen with every keystroke and click — and quietly builds a picture of how you actually work.

<img src="https://github.com/user-attachments/assets/c8857302-1604-42a1-b9b9-59d3be7e2321" alt="KeliKeli demo" width="100%" />

## Download 📦

[**→ Get the latest release**](../../releases/latest) — macOS 12+, Apple Silicon & Intel

> First launch may show a Gatekeeper warning. [Here's how to fix it.](#macos-gatekeeper-warnings)


## What you get 🎁

⚡ **Live feedback** — A floating badge animation appears on every key press and click. Feel your activity in real time.

🎨 **Customizable indicator** — Choose your indicator icon: pick any emoji or show the active app's icon. Set independent badge text for keystrokes, left clicks, and right clicks — with one-click presets or your own value.

📊 **Daily stats at a glance** — Click the menu bar icon to see today's keystroke count. No digging through dashboards.

📅 **30-day history** — Open Settings to see your activity over the past month: keystrokes, clicks, streaks, daily averages, and your all-time count.

🔍 **Per-app breakdown** — See exactly which apps are getting the most of your time and energy.

🌙 **Dark mode** — Choose System, Light, or Dark theme in Settings → General. Takes effect instantly.

🌐 **Multi-language support** — UI language auto-detected from your system, with a toggle in Settings → General.

💾 **Your data, your way** — Export everything as JSON, or stream live events to your own API or WebSocket server.


## Sync & integrations 🔗

KeliKeli can push your activity to any HTTP endpoint or WebSocket server you control.

Configure in **Settings → Connections**. Hit **Save & Reopen** after making changes.

### HTTP Sync

Posts a summary to your API on a schedule:

```json
{
  "synced_at": "2026-04-10T14:30:00+01:00",
  "totals": { "keystrokes": 12345, "left_clicks": 678, "right_clicks": 90 },
  "delta": {
    "keystrokes": 42, "left_clicks": 7, "right_clicks": 1, "period_secs": 60,
    "apps": [
      { "app": "Xcode", "keystrokes": 38, "left_clicks": 5, "right_clicks": 0 },
      { "app": "Safari", "keystrokes": 4, "left_clicks": 2, "right_clicks": 1 }
    ]
  }
}
```

### WebSocket

Streams individual events as they happen:

```json
{ "type": "keystroke", "app": "Xcode" }
{ "type": "left_click", "app": "Safari" }
{ "type": "right_click", "app": "Finder" }
{ "type": "typing_start" }
{ "type": "typing_stop" }
```

Reconnects automatically with exponential back-off (up to 5 min).


## Privacy 🔒

KeliKeli counts — it does not record. It never captures which keys you press, logs text input, or sends keystroke content anywhere. The system hook increments a counter and nothing more.

That said, any app granted Input Monitoring has the *technical capability* to read keystrokes. If that matters to you:

- Read the source before you run it.
- Verify the file hash against the release page before installing a pre-built binary.
- Only grant Input Monitoring to apps you trust.

### macOS Gatekeeper warnings

KeliKeli is signed but not notarized by Apple, so Gatekeeper will quarantine the download. You may see:

> *"Apple could not verify … is free of malware"* — on the DMG  
> *"KeliKeli is damaged and can't be opened"* — after installing

Both are the same issue: a quarantine flag macOS adds to internet downloads. Remove it with:

```sh
# On the DMG before mounting
xattr -dr com.apple.quarantine ~/Downloads/KeliKeli_x.x.x_universal.dmg

# Or on the installed app
xattr -dr com.apple.quarantine /Applications/KeliKeli.app
```

Alternatively: right-click → **Open** → **Open** to grant a one-time exception.

Only do this if you downloaded from the [official GitHub Releases](../../releases) page and the file hash matches.


## Settings reference ⚙️

| Setting | Description |
|---|---|
| Launch at startup | Auto-start when you log in |
| Flush interval | How often activity is written to disk (seconds) |
| Appearance | Theme: System / Light / Dark |
| Language | UI language: English / 中文 |
| Indicator → Icon type | Emoji (custom or preset) or active app's icon |
| Indicator → Badge text | Independent badge labels for keystroke / left click / right click |
| HTTP Sync | POST totals to your API on an interval |
| WebSocket | Stream live events to a server |


## Building from source 🛠️

**Prerequisites:** [Rust](https://rustup.rs) · [Node.js](https://nodejs.org) · [Tauri CLI](https://tauri.app/start/prerequisites/)

```sh
git clone https://github.com/WeiTanZzz/keli-keli.git
cd keli-keli/desktop

# npm
npm install && npm run build

# pnpm
pnpm install && pnpm build

# yarn
yarn && yarn build
```

The built app will be in `desktop/src-tauri/target/release/bundle/`.

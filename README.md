# KeliKeli

See every keystroke and click — right on your screen.

![keli-keli](https://github.com/user-attachments/assets/9b6c21f9-e1d4-4a93-a33b-0f16566ed54f)

KeliKeli is a lightweight macOS app that floats a live indicator on your screen and tracks your daily keyboard and mouse activity. It stays out of your way — living quietly in the menu bar — until you want to check in on your stats.

## What it does

**Floating indicator** — A small overlay shows a +1 animation every time you press a key or click, so you can feel your activity at a glance.

**Daily stats** — Open the menu bar icon to see today's total keystrokes and clicks. The Settings window shows a 30-day history, per-app breakdown, streaks, daily averages, and your all-time count.

**Tracks by app** — Know exactly which apps are getting the most of your keyboard time.

**Export your data** — Download your full history as JSON anytime from Settings → Connections.

**Stays in sync** — Optionally stream your activity to your own API or WebSocket server in real time.

**Auto-updates** — New versions install silently at launch.

## Download

Grab the latest `.dmg` from the [Releases](../../releases) page. Requires macOS 12 or later.

> **First launch:** macOS may warn that the app is from an unidentified developer. See [Gatekeeper warnings](#macos-gatekeeper-warnings) below.

## Settings

| Setting | What it does |
|---|---|
| Launch at startup | Start KeliKeli automatically when you log in |
| Flush interval | How often activity is saved to disk (seconds) |
| HTTP Sync | POST activity totals to your own API on an interval |
| WebSocket | Stream live keystroke and click events to a server |

> **Note:** Changes to HTTP Sync and WebSocket settings require a restart to take effect. Use **Save & Reopen** in the Connections tab — it handles this automatically.

### HTTP Sync payload

```json
{
  "synced_at": "2026-04-10T14:30:00+01:00",
  "totals": { "keystrokes": 12345, "left_clicks": 678, "right_clicks": 90 },
  "delta": { "keystrokes": 42, "left_clicks": 7, "right_clicks": 1, "period_secs": 60 }
}
```

### WebSocket events

```json
{ "type": "keystroke", "app": "Xcode" }
{ "type": "left_click", "app": "Safari" }
{ "type": "typing_start" }
{ "type": "typing_stop" }
```

Reconnects automatically on disconnect with exponential back-off (up to 5 min).

---

## Security & Privacy

### Privacy

KeliKeli counts keystrokes and mouse clicks — it does **not** record which keys are pressed, log any text input, or transmit keystroke content anywhere. The hook intercepts key and mouse events solely to increment counters.

That said, any app with Input Monitoring permission has the *technical capability* to read keystrokes. If you have concerns:

- Review the source code before running.
- If you downloaded a pre-built binary, verify its integrity (check the SHA256 hash against the release page) before installing.
- Grant Input Monitoring permission only to apps you trust.

### macOS Gatekeeper warnings

KeliKeli is signed with a self-signed certificate and is not notarized by Apple. macOS Gatekeeper therefore quarantines the download and may show one of two warnings:

**When opening the DMG:**
> "Apple could not verify 'KeliKeli_x.x.x_aarch64.dmg' is free of malware…"

**After installing the app:**
> "KeliKeli is damaged and can't be opened."

Both are caused by the same thing: macOS attaches a `com.apple.quarantine` extended attribute to every file downloaded from the internet. Because the app is not notarized, Gatekeeper refuses to lift the quarantine automatically.

**Fix — remove the quarantine flag:**

On the DMG before mounting:
```sh
xattr -dr com.apple.quarantine ~/Downloads/KeliKeli_x.x.x_aarch64.dmg
```

Or on the installed app:
```sh
xattr -dr com.apple.quarantine /Applications/KeliKeli.app
```

Alternatively, right-click the file in Finder → **Open** → click **Open** in the dialog to grant a one-time exception.

Only do this if you downloaded the app from the [official GitHub Releases](../../releases) page and have verified the file hash matches the one listed there.

### General tips

- Always download from the [official GitHub Releases](../../releases) page and check that the file hash matches what is listed there.
- Keep macOS up to date so that system-level security mitigations are current.
- If you no longer use the app, revoke Input Monitoring permission in **System Settings → Privacy & Security → Input Monitoring**.

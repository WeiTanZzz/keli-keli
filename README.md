# KeliKeli

**Your keystrokes, counted. Your habits, revealed.**

![keli-keli](https://github.com/user-attachments/assets/9b6c21f9-e1d4-4a93-a33b-0f16566ed54f)

A tiny macOS app that floats a live +1 on your screen with every keystroke and click — and quietly builds a picture of how you actually work.

## Download

[**→ Get the latest release**](../../releases/latest) — macOS 12+, Apple Silicon & Intel

> First launch may show a Gatekeeper warning. [Here's how to fix it.](#macos-gatekeeper-warnings)

---

## What you get

**Live feedback** — A floating +1 animation appears on every key press and click. Feel your activity in real time.

**Daily stats at a glance** — Click the menu bar icon to see today's keystroke count. No digging through dashboards.

**30-day history** — Open Settings to see your activity over the past month: keystrokes, clicks, streaks, daily averages, and your all-time count.

**Per-app breakdown** — See exactly which apps are getting the most of your time and energy.

**Your data, your way** — Export everything as JSON, or stream live events to your own API or WebSocket server.

---

## Sync & integrations

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

---

## Privacy

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
xattr -dr com.apple.quarantine ~/Downloads/KeliKeli_x.x.x_aarch64.dmg

# Or on the installed app
xattr -dr com.apple.quarantine /Applications/KeliKeli.app
```

Alternatively: right-click → **Open** → **Open** to grant a one-time exception.

Only do this if you downloaded from the [official GitHub Releases](../../releases) page and the file hash matches.

---

## Settings reference

| Setting | Description |
|---|---|
| Launch at startup | Auto-start when you log in |
| Flush interval | How often activity is written to disk (seconds) |
| HTTP Sync | POST totals to your API on an interval |
| WebSocket | Stream live events to a server |

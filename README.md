# keli-keli

A macOS menu bar app that tracks keystrokes and mouse clicks in real time.

![keli-keli](https://github.com/user-attachments/assets/9b6c21f9-e1d4-4a93-a33b-0f16566ed54f)


## Features

- Floating keyboard indicator on screen
- Tray menu showing today's keystroke count
- Tracks key presses, left clicks, and right clicks per app
- Local data persistence (JSON)
- Optional HTTP sync — POST activity counts to your own API
- Optional WebSocket — stream typing and click events in real time
- Auto-update: check for new releases at launch

## Requirements

- macOS 12+
- [Input Monitoring](x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent) permission

## Structure

```
desktop/
├── src/                  # React frontend
│   ├── App.tsx           # Floating indicator UI
│   ├── Settings.tsx      # Settings window (statistics, sync, WebSocket, about)
│   └── main.tsx
└── src-tauri/
    └── src/
        ├── lib.rs        # App setup, key/sync/WebSocket loops, tray, Tauri commands
        ├── hook.rs       # CGEventTap keyboard and mouse hook
        ├── storage.rs    # Daily activity persistence (JSON)
        └── config.rs     # User config (sync, WebSocket)
```

## Dev

```sh
cd desktop && pnpm tauri dev
```

## Config

Stored at `~/Library/Application Support/keli-keli/config.toml`.

```toml
flush_interval_secs = 60

[sync]
enabled = false
api_url = ""
api_key = ""
interval_secs = 60

[websocket]
enabled = false
ws_url = ""
typing_idle_ms = 2000
```

> **Note:** Changes to WebSocket URL, Sync URL, and the enable/disable toggles
> require an app restart to take effect. Flush interval and typing idle timeout
> update immediately after saving.

### HTTP Sync

When enabled, POSTs to `api_url` every `interval_secs` seconds with header
`Authorization: Bearer <api_key>`:

```json
{
  "synced_at": "2026-04-10T14:30:00+01:00",
  "totals": {
    "keystrokes": 12345,
    "left_clicks": 678,
    "right_clicks": 90
  },
  "delta": {
    "keystrokes": 42,
    "left_clicks": 7,
    "right_clicks": 1,
    "period_secs": 60,
    "apps": [
      { "app": "Xcode",  "keystrokes": 38, "left_clicks": 5, "right_clicks": 0 },
      { "app": "Safari", "keystrokes": 4,  "left_clicks": 2, "right_clicks": 1 }
    ]
  }
}
```

`totals` is the all-time cumulative count; `delta` is the activity since the
previous sync interval.

### WebSocket

When enabled, connects to `ws_url` and streams JSON messages:

```json
{ "type": "keystroke", "app": "Xcode" }
{ "type": "left_click", "app": "Safari" }
{ "type": "right_click", "app": "Finder" }
{ "type": "typing_start" }
{ "type": "typing_stop" }
```

Reconnects automatically on disconnect with exponential back-off (up to 5 min).

## Security & Privacy

### Privacy

keli-keli counts keystrokes and mouse clicks — it does **not** record which
keys are pressed, log any text input, or transmit keystroke content anywhere.
The hook intercepts key and mouse events solely to increment counters.

That said, any app with Input Monitoring permission has the *technical
capability* to read keystrokes. If you have concerns:

- Review the source code before running.
- If you downloaded a pre-built binary, verify its integrity (check the SHA256
  hash against the release page) before installing.
- Grant Input Monitoring permission only to apps you trust.

### macOS Gatekeeper warnings

keli-keli is signed with a self-signed certificate and is not notarized by
Apple. macOS Gatekeeper therefore quarantines the download and may show one of
two warnings:

**When opening the DMG:**
> "Apple could not verify 'KeliKeli_x.x.x_aarch64.dmg' is free of malware…"

**After installing the app:**
> "KeliKeli is damaged and can't be opened."

Both are caused by the same thing: macOS attaches a `com.apple.quarantine`
extended attribute to every file downloaded from the internet. Because the app
is not notarized, Gatekeeper refuses to lift the quarantine automatically.

**Fix — remove the quarantine flag:**

On the DMG before mounting:
```sh
xattr -dr com.apple.quarantine ~/Downloads/KeliKeli_x.x.x_aarch64.dmg
```

Or on the installed app:
```sh
xattr -dr com.apple.quarantine /Applications/KeliKeli.app
```

Alternatively, right-click the file in Finder → **Open** → click **Open** in
the dialog to grant a one-time exception.

Only do this if you downloaded the app from the
[official GitHub Releases](../../releases) page and have verified the file
hash matches the one listed there.

### General tips

- Always download from the [official GitHub Releases](../../releases) page and
  check that the file hash matches what is listed there.
- Keep macOS up to date so that system-level security mitigations are current.
- If you no longer use the app, revoke Input Monitoring permission in
  **System Settings → Privacy & Security → Input Monitoring**.

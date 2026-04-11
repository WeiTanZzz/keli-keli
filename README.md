# keli-keli

A macOS menu bar app that counts keystrokes in real time.

![keli-keli](https://github.com/user-attachments/assets/9b6c21f9-e1d4-4a93-a33b-0f16566ed54f)


## Features

- Floating keyboard indicator on screen
- Daily keystroke count in the menu bar
- Local data persistence (JSON)
- Optional HTTP sync — POST daily counts to your own API
- Optional WebSocket — stream typing events in real time

## Requirements

- macOS 12+
- [Input Monitoring](x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent) permission

## Structure

```
desktop/
├── src/                  # React frontend
│   ├── App.tsx           # Floating indicator UI
│   ├── Settings.tsx      # Settings window
│   └── main.tsx
└── src-tauri/
    └── src/
        ├── lib.rs        # App setup, key loop, tray, Tauri commands
        ├── hook.rs       # CGEventTap keyboard hook
        ├── storage.rs    # Daily keystroke persistence (JSON)
        └── config.rs     # User config (sync, WebSocket)
```

## Dev

```sh
cd desktop && pnpm tauri dev
```

## Config

Stored at `~/Library/Application Support/com.weitanzzz.keli-keli/config.toml`.

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

### HTTP Sync

When enabled, POSTs to `api_url` every `interval_secs` seconds:

```json
{ "date": "2026-04-10", "count": 1234 }
```

With header `Authorization: Bearer <api_key>`.

### WebSocket

When enabled, connects to `ws_url` and sends:

```json
{ "type": "keystroke", "count": 1234 }
{ "type": "typing_start" }
{ "type": "typing_stop" }
```

Reconnects automatically on disconnect.

## Security & Privacy

### Privacy

keli-keli only counts keystrokes — it does **not** record which keys are pressed, log any text input, or transmit keystroke content anywhere. The hook intercepts key events solely to increment a counter.

That said, any app with Input Monitoring permission has the *technical capability* to read keystrokes. If you have concerns:

- Review the source code before running.
- If you downloaded a pre-built binary, verify its integrity (check the SHA256 hash against the release page) before installing.
- Grant Input Monitoring permission only to apps you trust.

### "KeliKeli is damaged and can't be opened"

macOS Gatekeeper may block unsigned or unnotarized apps with this message. To bypass it:

```sh
xattr -dr com.apple.quarantine /Applications/KeliKeli.app
```

This removes the quarantine flag that macOS sets on downloaded files. Only run this if you downloaded the app from a trusted source and have verified its integrity.

### General tips

- Always download from the [official GitHub Releases](../../releases) page and check that the file hash matches what is listed there.
- Keep macOS up to date so that system-level security mitigations are current.
- If you no longer use the app, revoke Input Monitoring permission in **System Settings → Privacy & Security → Input Monitoring**.

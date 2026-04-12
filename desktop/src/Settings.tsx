import { invoke } from "@tauri-apps/api/core"
import { type ReactNode, useEffect, useState } from "react"

interface Config {
    flush_interval_secs: number
    sync: {
        enabled: boolean
        api_url: string
        api_key: string
        interval_secs: number
    }
    websocket: { enabled: boolean; ws_url: string; typing_idle_ms: number }
}

interface DayStat {
    date: string
    count: number
}

function Chart({ stats }: { stats: DayStat[] }) {
    const max = Math.max(...stats.map((s) => s.count), 1)
    const today = new Date().toISOString().slice(0, 10)
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div
                style={{
                    display: "flex",
                    alignItems: "flex-end",
                    gap: 3,
                    height: 64,
                }}
            >
                {stats.map((s) => {
                    const pct = (s.count / max) * 100
                    const isToday = s.date === today
                    return (
                        <div
                            key={s.date}
                            title={`${s.date}: ${s.count.toLocaleString()}`}
                            style={{
                                flex: 1,
                                height: "100%",
                                display: "flex",
                                flexDirection: "column",
                                justifyContent: "flex-end",
                            }}
                        >
                            <div
                                style={{
                                    width: "100%",
                                    height: `${pct}%`,
                                    minHeight: s.count ? 2 : 0,
                                    background: isToday ? "#6366f1" : "#e0e0e0",
                                    borderRadius: 3,
                                }}
                            />
                        </div>
                    )
                })}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 10, color: "#aaa" }}>
                    {stats[0]?.date.slice(5)}
                </span>
                <span style={{ fontSize: 10, color: "#aaa" }}>today</span>
            </div>
        </div>
    )
}

function Toggle({
    checked,
    onChange,
}: {
    checked: boolean
    onChange: (v: boolean) => void
}) {
    return (
        <div
            onClick={() => onChange(!checked)}
            style={{
                width: 36,
                height: 20,
                borderRadius: 10,
                cursor: "pointer",
                background: checked ? "#6366f1" : "#d1d5db",
                position: "relative",
                transition: "background 0.2s",
                flexShrink: 0,
            }}
        >
            <div
                style={{
                    position: "absolute",
                    top: 2,
                    left: checked ? 18 : 2,
                    width: 16,
                    height: 16,
                    borderRadius: "50%",
                    background: "#fff",
                    transition: "left 0.2s",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                }}
            />
        </div>
    )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div
            style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                minHeight: 32,
            }}
        >
            <span style={{ fontSize: 13, color: "#374151" }}>{label}</span>
            {children}
        </div>
    )
}

function Input({
    value,
    onChange,
    type = "text",
    placeholder = "",
}: {
    value: string | number
    onChange: (v: string) => void
    type?: string
    placeholder?: string
}) {
    return (
        <input
            type={type}
            value={value}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            style={{
                fontSize: 12,
                color: "#374151",
                background: "#f9fafb",
                border: "1px solid #e5e7eb",
                borderRadius: 6,
                padding: "4px 8px",
                width: type === "number" ? 72 : 160,
                outline: "none",
                fontFamily: "inherit",
            }}
        />
    )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span
                style={{
                    fontSize: 10,
                    fontWeight: 600,
                    color: "#9ca3af",
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    marginBottom: 4,
                }}
            >
                {title}
            </span>
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    background: "#fff",
                    borderRadius: 10,
                    padding: "8px 12px",
                    border: "1px solid #e5e7eb",
                }}
            >
                {children}
            </div>
        </div>
    )
}

type UpdateState =
    | { status: "checking" }
    | { status: "latest"; version: string }
    | { status: "available"; current: string; latest: string }
    | { status: "installing" }
    | { status: "error"; message: string }

export default function Settings() {
    const [cfg, setCfg] = useState<Config | null>(null)
    const [autostart, setAutostart] = useState(false)
    const [stats, setStats] = useState<DayStat[]>([])
    const [saved, setSaved] = useState(false)
    const [update, setUpdate] = useState<UpdateState>({ status: "checking" })

    useEffect(() => {
        invoke<Config>("get_config").then(setCfg)
        invoke<boolean>("get_autostart").then(setAutostart)
        invoke<DayStat[]>("get_stats", { days: 14 }).then(setStats)
        invoke<{ current: string; latest: string | null; available: boolean }>(
            "check_update",
        )
            .then((info) => {
                if (info.available && info.latest) {
                    setUpdate({
                        status: "available",
                        current: info.current,
                        latest: info.latest,
                    })
                } else {
                    setUpdate({ status: "latest", version: info.current })
                }
            })
            .catch(() =>
                setUpdate({
                    status: "error",
                    message: "Could not reach update server",
                }),
            )
    }, [])

    const handleInstall = async () => {
        setUpdate({ status: "installing" })
        try {
            await invoke("install_update")
        } catch (e) {
            setUpdate({ status: "error", message: String(e) })
        }
    }

    const handleAutostart = (v: boolean) => {
        setAutostart(v)
        invoke("set_autostart", { enabled: v })
    }

    const handleSave = async () => {
        if (!cfg) return
        await invoke("save_config", { newCfg: cfg })
        setSaved(true)
        setTimeout(() => setSaved(false), 1500)
    }

    const set = (update: Partial<Config>) =>
        setCfg((c) => (c ? { ...c, ...update } : c))
    const setSync = (update: Partial<Config["sync"]>) =>
        setCfg((c) => (c ? { ...c, sync: { ...c.sync, ...update } } : c))
    const setWs = (update: Partial<Config["websocket"]>) =>
        setCfg((c) =>
            c ? { ...c, websocket: { ...c.websocket, ...update } } : c,
        )

    if (!cfg) return null

    const todayCount =
        stats.find((s) => s.date === new Date().toISOString().slice(0, 10))
            ?.count ?? 0

    return (
        <div
            style={{
                background: "#f3f4f6",
                height: "100vh",
                overflowY: "auto",
                padding: 16,
                display: "flex",
                flexDirection: "column",
                gap: 14,
                fontFamily: "-apple-system, sans-serif",
            }}
        >
            {/* Stats */}
            <Section title="Statistics">
                <div
                    style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "baseline",
                    }}
                >
                    <span
                        style={{ fontSize: 28, fontWeight: 700, color: "#111" }}
                    >
                        {todayCount.toLocaleString()}
                    </span>
                    <span style={{ fontSize: 11, color: "#9ca3af" }}>
                        keystrokes today
                    </span>
                </div>
                <Chart stats={stats} />
            </Section>

            {/* General */}
            <Section title="General">
                <Row label="Launch at startup">
                    <Toggle checked={autostart} onChange={handleAutostart} />
                </Row>
                <div style={{ height: 1, background: "#f3f4f6" }} />
                <Row label="Flush interval (s)">
                    <Input
                        type="number"
                        value={cfg.flush_interval_secs}
                        onChange={(v) =>
                            set({ flush_interval_secs: Number(v) })
                        }
                    />
                </Row>
            </Section>

            {/* API Sync */}
            <Section title="HTTP Sync">
                <Row label="Enabled">
                    <Toggle
                        checked={cfg.sync.enabled}
                        onChange={(v) => setSync({ enabled: v })}
                    />
                </Row>
                {cfg.sync.enabled && (
                    <>
                        <div style={{ height: 1, background: "#f3f4f6" }} />
                        <Row label="API URL">
                            <Input
                                value={cfg.sync.api_url}
                                onChange={(v) => setSync({ api_url: v })}
                                placeholder="https://..."
                            />
                        </Row>
                        <Row label="API Key">
                            <Input
                                value={cfg.sync.api_key}
                                onChange={(v) => setSync({ api_key: v })}
                                placeholder="sk-..."
                            />
                        </Row>
                    </>
                )}
            </Section>

            {/* WebSocket */}
            <Section title="WebSocket">
                <Row label="Enabled">
                    <Toggle
                        checked={cfg.websocket.enabled}
                        onChange={(v) => setWs({ enabled: v })}
                    />
                </Row>
                {cfg.websocket.enabled && (
                    <>
                        <div style={{ height: 1, background: "#f3f4f6" }} />
                        <Row label="WS URL">
                            <Input
                                value={cfg.websocket.ws_url}
                                onChange={(v) => setWs({ ws_url: v })}
                                placeholder="wss://..."
                            />
                        </Row>
                        <Row label="Idle timeout (ms)">
                            <Input
                                type="number"
                                value={cfg.websocket.typing_idle_ms}
                                onChange={(v) =>
                                    setWs({ typing_idle_ms: Number(v) })
                                }
                            />
                        </Row>
                    </>
                )}
            </Section>

            {/* About */}
            <Section title="About">
                <Row label="Version">
                    {update.status === "checking" && (
                        <span style={{ fontSize: 12, color: "#9ca3af" }}>
                            Checking…
                        </span>
                    )}
                    {update.status === "latest" && (
                        <span style={{ fontSize: 12, color: "#9ca3af" }}>
                            v{update.version} · Up to date
                        </span>
                    )}
                    {update.status === "available" && (
                        <div
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                            }}
                        >
                            <span style={{ fontSize: 12, color: "#9ca3af" }}>
                                v{update.current}
                            </span>
                            <button
                                type="button"
                                onClick={handleInstall}
                                style={{
                                    fontSize: 11,
                                    fontWeight: 600,
                                    color: "#fff",
                                    background: "#6366f1",
                                    border: "none",
                                    borderRadius: 6,
                                    padding: "3px 10px",
                                    cursor: "pointer",
                                    fontFamily: "inherit",
                                }}
                            >
                                Update to v{update.latest}
                            </button>
                        </div>
                    )}
                    {update.status === "installing" && (
                        <span style={{ fontSize: 12, color: "#6366f1" }}>
                            Installing, will restart shortly…
                        </span>
                    )}
                    {update.status === "error" && (
                        <span style={{ fontSize: 12, color: "#ef4444" }}>
                            {update.message}
                        </span>
                    )}
                </Row>
            </Section>

            <button
                type="button"
                onClick={handleSave}
                style={{
                    background: saved ? "#10b981" : "#6366f1",
                    color: "#fff",
                    border: "none",
                    borderRadius: 10,
                    padding: "10px 0",
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "background 0.2s",
                    fontFamily: "inherit",
                }}
            >
                {saved ? "Saved ✓" : "Save"}
            </button>
        </div>
    )
}

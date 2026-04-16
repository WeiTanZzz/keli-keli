import { listen } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { BarChart2, Globe, Info, Settings2, Zap } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import {
    type AllTimeCounts,
    type AppClickStat,
    type AppStat,
    api,
    type Config,
    type DayStat,
} from "@/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import {
    AppBreakdownChart,
    DailyBarChart,
    Last7DaysChart,
} from "./settings/charts"
import { computeStreak, localDateStr } from "./settings/helpers"

type NavId = "statistics" | "general" | "sync" | "websocket" | "about"

type UpdateState =
    | { status: "checking" }
    | { status: "latest"; version: string }
    | { status: "available"; current: string; latest: string }
    | { status: "installing" }
    | { status: "error"; message: string }

const NAV_ITEMS: { id: NavId; label: string; icon: React.ElementType }[] = [
    { id: "statistics", label: "Statistics", icon: BarChart2 },
    { id: "general", label: "General", icon: Settings2 },
    { id: "sync", label: "HTTP Sync", icon: Globe },
    { id: "websocket", label: "WebSocket", icon: Zap },
    { id: "about", label: "About", icon: Info },
]

// ─── UI primitives ────────────────────────────────────────────────────────────

function StatChip({
    label,
    value,
    sub,
}: {
    label: string
    value: string
    sub?: string
}) {
    return (
        <div className="flex flex-col gap-1 px-3 py-3">
            <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-widest leading-none mb-1">
                {label}
            </span>
            <span className="text-xl font-bold text-zinc-800 tabular-nums leading-none">
                {value}
            </span>
            <span className="text-[10px] text-zinc-400 leading-none mt-0.5">
                {sub ?? ""}
            </span>
        </div>
    )
}

function FormRow({
    label,
    description,
    children,
}: {
    label: string
    description?: string
    children: React.ReactNode
}) {
    return (
        <div className="flex items-center justify-between gap-4 py-3 px-4">
            <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-sm text-zinc-800">{label}</span>
                {description && (
                    <span className="text-xs text-zinc-400">{description}</span>
                )}
            </div>
            {children}
        </div>
    )
}

function Card({ children }: { children: React.ReactNode }) {
    return (
        <div className="bg-white rounded-xl border border-zinc-200 divide-y divide-zinc-100 overflow-hidden">
            {children}
        </div>
    )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex items-center gap-2 mb-1">
            <span className="w-1 h-3.5 rounded-full bg-indigo-400 shrink-0" />
            <h2 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-widest">
                {children}
            </h2>
        </div>
    )
}

// ─── Sections ─────────────────────────────────────────────────────────────────

function StatisticsSection({
    stats,
    appStats,
    clickStats,
    allTimeCounts,
}: {
    stats: DayStat[]
    appStats: AppStat[]
    clickStats: AppClickStat[]
    allTimeCounts: AllTimeCounts | null
}) {
    const [selectedDate, setSelectedDate] = useState<string | null>(null)
    const today = localDateStr()
    const yesterday = localDateStr(new Date(Date.now() - 86400000))

    // Daily click totals (left + right) per date
    const dailyClicks = useMemo(() => {
        const m = new Map<string, number>()
        for (const s of clickStats) {
            m.set(s.date, (m.get(s.date) ?? 0) + s.left_clicks + s.right_clicks)
        }
        return m
    }, [clickStats])

    const todayTotal = useMemo(
        () =>
            (stats.find((s) => s.date === today)?.count ?? 0) +
            (dailyClicks.get(today) ?? 0),
        [stats, dailyClicks, today],
    )
    const yesterdayTotal = useMemo(
        () =>
            (stats.find((s) => s.date === yesterday)?.count ?? 0) +
            (dailyClicks.get(yesterday) ?? 0),
        [stats, dailyClicks, yesterday],
    )

    // Hero: keys + clicks for selected date (or today)
    const isViewingToday = selectedDate === null || selectedDate === today
    const heroCount = useMemo(() => {
        if (isViewingToday) return todayTotal
        const d = selectedDate ?? today
        return (
            (stats.find((s) => s.date === d)?.count ?? 0) +
            (dailyClicks.get(d) ?? 0)
        )
    }, [stats, dailyClicks, selectedDate, isViewingToday, todayTotal, today])

    // Trend: compare total activity (keys + clicks)
    const trendPct = useMemo(() => {
        if (isViewingToday) {
            return yesterdayTotal > 0
                ? Math.round(
                      ((todayTotal - yesterdayTotal) / yesterdayTotal) * 100,
                  )
                : null
        }
        return todayTotal > 0
            ? Math.round(((heroCount - todayTotal) / todayTotal) * 100)
            : null
    }, [isViewingToday, todayTotal, yesterdayTotal, heroCount])

    const heroLabel = isViewingToday
        ? "actions today"
        : `actions · ${selectedDate}`

    // All-dates total actions (keys + clicks) per date
    const dailyTotals = useMemo(() => {
        const allDates = new Set([
            ...stats.map((s) => s.date),
            ...dailyClicks.keys(),
        ])
        return Array.from(allDates).map((date) => ({
            date,
            total:
                (stats.find((s) => s.date === date)?.count ?? 0) +
                (dailyClicks.get(date) ?? 0),
        }))
    }, [stats, dailyClicks])

    const daysWithData = useMemo(
        () => dailyTotals.filter((d) => d.total > 0),
        [dailyTotals],
    )
    const avgCount = useMemo(
        () =>
            daysWithData.length > 0
                ? Math.round(
                      daysWithData.reduce((sum, d) => sum + d.total, 0) /
                          daysWithData.length,
                  )
                : 0,
        [daysWithData],
    )
    const bestDay = useMemo(
        () =>
            dailyTotals.reduce((best, d) => (d.total > best.total ? d : best), {
                date: "",
                total: 0,
            }),
        [dailyTotals],
    )
    const streak = useMemo(() => computeStreak(stats), [stats])
    const allTimeTotal = allTimeCounts
        ? allTimeCounts.keystrokes +
          allTimeCounts.left_clicks +
          allTimeCounts.right_clicks
        : null

    return (
        <div className="flex flex-col gap-6">
            {/* Hero + 30-day chart */}
            <div className="flex flex-col gap-2">
                <SectionTitle>Activity</SectionTitle>
                <Card>
                    <div className="px-4 pt-4 pb-3 flex flex-col gap-3">
                        <div className="flex items-baseline justify-between">
                            <div className="flex items-baseline gap-2">
                                <span className="text-4xl font-bold text-zinc-900 tabular-nums">
                                    {heroCount.toLocaleString()}
                                </span>
                                {trendPct !== null && (
                                    <span className="flex items-baseline gap-1">
                                        <span
                                            className={cn(
                                                "text-xs font-medium tabular-nums",
                                                trendPct >= 0
                                                    ? "text-emerald-500"
                                                    : "text-red-400",
                                            )}
                                        >
                                            {trendPct >= 0 ? "+" : ""}
                                            {trendPct}%
                                        </span>
                                        {!isViewingToday && (
                                            <span className="text-[10px] text-zinc-400">
                                                vs today
                                            </span>
                                        )}
                                    </span>
                                )}
                            </div>
                            <span className="text-xs text-zinc-400">
                                {heroLabel}
                            </span>
                        </div>
                        <DailyBarChart
                            stats={stats}
                            clickStats={clickStats}
                            selectedDate={selectedDate}
                            onSelectDate={setSelectedDate}
                        />
                    </div>

                    {/* Stat chips — 4 columns inline */}
                    <div className="grid grid-cols-4 divide-x divide-zinc-100 border-t border-zinc-100">
                        <StatChip
                            label="Daily avg"
                            value={
                                avgCount >= 1_000_000
                                    ? `${(avgCount / 1_000_000).toFixed(1)}M`
                                    : avgCount >= 1_000
                                      ? `${(avgCount / 1_000).toFixed(1)}K`
                                      : avgCount.toLocaleString()
                            }
                            sub="actions"
                        />
                        <StatChip
                            label="Best day"
                            value={
                                bestDay.total >= 1_000_000
                                    ? `${(bestDay.total / 1_000_000).toFixed(1)}M`
                                    : bestDay.total >= 1_000
                                      ? `${(bestDay.total / 1_000).toFixed(1)}K`
                                      : bestDay.total.toLocaleString()
                            }
                            sub={
                                bestDay.date ? bestDay.date.slice(5) : undefined
                            }
                        />
                        <StatChip
                            label="Streak"
                            value={streak > 0 ? `${streak}d` : "—"}
                            sub={streak > 0 ? "in a row" : "no streak"}
                        />
                        <StatChip
                            label="All time"
                            value={
                                allTimeTotal === null
                                    ? "—"
                                    : allTimeTotal >= 1_000_000
                                      ? `${(allTimeTotal / 1_000_000).toFixed(1)}M`
                                      : allTimeTotal >= 1_000
                                        ? `${(allTimeTotal / 1_000).toFixed(1)}K`
                                        : allTimeTotal.toLocaleString()
                            }
                            sub="actions"
                        />
                    </div>
                </Card>
            </div>

            {/* Day-of-week pattern */}
            <div className="flex flex-col gap-2">
                <SectionTitle>Last 7 Days</SectionTitle>
                <Card>
                    <div className="px-4 py-4">
                        <Last7DaysChart stats={stats} clickStats={clickStats} />
                    </div>
                </Card>
            </div>

            {/* App breakdown */}
            <div className="flex flex-col gap-2">
                <SectionTitle>By App</SectionTitle>
                <Card>
                    <div className="px-4 py-4">
                        <AppBreakdownChart
                            appStats={appStats}
                            clickStats={clickStats}
                        />
                    </div>
                </Card>
            </div>
        </div>
    )
}

function GeneralSection({
    autostart,
    cfg,
    onAutostart,
    onFlushInterval,
}: {
    autostart: boolean
    cfg: Config
    onAutostart: (v: boolean) => void
    onFlushInterval: (v: string) => void
}) {
    return (
        <div className="flex flex-col gap-4">
            <SectionTitle>General</SectionTitle>
            <Card>
                <FormRow
                    label="Launch at startup"
                    description="Start KeliKeli when you log in"
                >
                    <Switch checked={autostart} onCheckedChange={onAutostart} />
                </FormRow>
                <FormRow
                    label="Flush interval"
                    description="How often to save data (seconds)"
                >
                    <Input
                        type="number"
                        value={cfg.flush_interval_secs}
                        onChange={(e) => onFlushInterval(e.target.value)}
                        className="w-20"
                    />
                </FormRow>
            </Card>
        </div>
    )
}

function SyncSection({
    cfg,
    onUpdate,
}: {
    cfg: Config
    onUpdate: (patch: Partial<Config["sync"]>) => void
}) {
    return (
        <div className="flex flex-col gap-4">
            <SectionTitle>HTTP Sync</SectionTitle>
            <Card>
                <FormRow
                    label="Enabled"
                    description="Send keystroke data to your API"
                >
                    <Switch
                        checked={cfg.sync.enabled}
                        onCheckedChange={(v) => onUpdate({ enabled: v })}
                    />
                </FormRow>
                {cfg.sync.enabled && (
                    <>
                        <FormRow label="API URL">
                            <Input
                                value={cfg.sync.api_url}
                                onChange={(e) =>
                                    onUpdate({ api_url: e.target.value })
                                }
                                placeholder="https://..."
                            />
                        </FormRow>
                        <FormRow label="API Key">
                            <Input
                                value={cfg.sync.api_key}
                                onChange={(e) =>
                                    onUpdate({ api_key: e.target.value })
                                }
                                placeholder="sk-..."
                                type="password"
                            />
                        </FormRow>
                        <FormRow label="Sync interval (s)">
                            <Input
                                type="number"
                                value={cfg.sync.interval_secs}
                                onChange={(e) =>
                                    onUpdate({
                                        interval_secs: Number(e.target.value),
                                    })
                                }
                            />
                        </FormRow>
                    </>
                )}
            </Card>
        </div>
    )
}

function WebSocketSection({
    cfg,
    onUpdate,
}: {
    cfg: Config
    onUpdate: (patch: Partial<Config["websocket"]>) => void
}) {
    return (
        <div className="flex flex-col gap-4">
            <SectionTitle>WebSocket</SectionTitle>
            <Card>
                <FormRow
                    label="Enabled"
                    description="Stream keystrokes in real time"
                >
                    <Switch
                        checked={cfg.websocket.enabled}
                        onCheckedChange={(v) => onUpdate({ enabled: v })}
                    />
                </FormRow>
                {cfg.websocket.enabled && (
                    <>
                        <FormRow label="WS URL">
                            <Input
                                value={cfg.websocket.ws_url}
                                onChange={(e) =>
                                    onUpdate({ ws_url: e.target.value })
                                }
                                placeholder="wss://..."
                            />
                        </FormRow>
                        <FormRow label="Idle timeout (ms)">
                            <Input
                                type="number"
                                value={cfg.websocket.typing_idle_ms}
                                onChange={(e) =>
                                    onUpdate({
                                        typing_idle_ms: Number(e.target.value),
                                    })
                                }
                            />
                        </FormRow>
                    </>
                )}
            </Card>
        </div>
    )
}

function AboutSection({
    update,
    cfg,
    onInstall,
    onAutoUpdate,
}: {
    update: UpdateState
    cfg: Config
    onInstall: () => void
    onAutoUpdate: (v: boolean) => void
}) {
    return (
        <div className="flex flex-col gap-4">
            <SectionTitle>About</SectionTitle>
            <Card>
                <FormRow label="Version">
                    {update.status === "checking" && (
                        <span className="text-xs text-zinc-400">Checking…</span>
                    )}
                    {update.status === "latest" && (
                        <span className="text-xs text-zinc-400">
                            v{update.version} · Up to date
                        </span>
                    )}
                    {update.status === "available" && (
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-zinc-400">
                                v{update.current}
                            </span>
                            <Button size="sm" onClick={onInstall}>
                                Update to v{update.latest}
                            </Button>
                        </div>
                    )}
                    {update.status === "installing" && (
                        <span className="text-xs text-indigo-500">
                            Installing, restarting shortly…
                        </span>
                    )}
                    {update.status === "error" && (
                        <span className="text-xs text-red-500">
                            {update.message}
                        </span>
                    )}
                </FormRow>
                <FormRow
                    label="Auto-update"
                    description="Automatically install updates at launch"
                >
                    <Switch
                        checked={cfg.auto_update}
                        onCheckedChange={onAutoUpdate}
                    />
                </FormRow>
            </Card>
        </div>
    )
}

// ─── Custom titlebar ──────────────────────────────────────────────────────────

function TitleBar() {
    const win = getCurrentWindow()
    return (
        <div
            data-tauri-drag-region
            className="relative flex h-9 items-center shrink-0 bg-zinc-50 border-b border-zinc-200"
        >
            {/* macOS traffic-light buttons */}
            <div className="flex items-center gap-1.5 px-3 z-10">
                <button
                    type="button"
                    onClick={() => win.close()}
                    className="group w-3 h-3 rounded-full bg-[#ff5f57] flex items-center justify-center transition-opacity hover:opacity-90"
                    aria-label="Close"
                >
                    <span className="opacity-0 group-hover:opacity-100 text-[7px] text-[#590000] font-black leading-none select-none">
                        ✕
                    </span>
                </button>
                <button
                    type="button"
                    onClick={() => win.minimize()}
                    className="group w-3 h-3 rounded-full bg-[#febc2e] flex items-center justify-center transition-opacity hover:opacity-90"
                    aria-label="Minimize"
                >
                    <span className="opacity-0 group-hover:opacity-100 text-[9px] text-[#5a3d00] font-black leading-none select-none">
                        −
                    </span>
                </button>
                {/* Zoom button — disabled, window is fixed size */}
                <div
                    className="w-3 h-3 rounded-full bg-[#28c840] opacity-40 cursor-not-allowed"
                    aria-label="Zoom (unavailable)"
                />
            </div>

            {/* Centered title — pointer-events-none so drag region stays active */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span className="text-[12px] font-medium text-zinc-500 select-none">
                    KeliKeli
                </span>
            </div>
        </div>
    )
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function Settings() {
    const [cfg, setCfg] = useState<Config | null>(null)
    const [autostart, setAutostart] = useState(false)
    const [stats, setStats] = useState<DayStat[]>([])
    const [appStats, setAppStats] = useState<AppStat[]>([])
    const [clickStats, setClickStats] = useState<AppClickStat[]>([])
    const [allTimeCounts, setAllTimeCounts] = useState<AllTimeCounts | null>(
        null,
    )
    const [saved, setSaved] = useState(false)
    const [update, setUpdate] = useState<UpdateState>({ status: "checking" })
    const [active, setActive] = useState<NavId>("statistics")

    useEffect(() => {
        const today = localDateStr()
        const unlisten = listen<{ count: number; app: string }>(
            "keystroke",
            (e) => {
                setStats((prev) => {
                    const exists = prev.some((s) => s.date === today)
                    if (exists) {
                        return prev.map((s) =>
                            s.date === today
                                ? { ...s, count: e.payload.count }
                                : s,
                        )
                    }
                    return [...prev, { date: today, count: e.payload.count }]
                })
                setAppStats((prev) => {
                    const exists = prev.some(
                        (s) => s.date === today && s.app === e.payload.app,
                    )
                    if (exists) {
                        return prev.map((s) =>
                            s.date === today && s.app === e.payload.app
                                ? { ...s, count: s.count + 1 }
                                : s,
                        )
                    }
                    return [
                        ...prev,
                        { date: today, app: e.payload.app, count: 1 },
                    ]
                })
            },
        )

        const unlistenClick = listen<{ app: string; button: number }>(
            "click",
            (e) => {
                const { app, button } = e.payload
                // Only track left (0) and right (1) clicks
                if (button !== 0 && button !== 1) return
                setClickStats((prev) => {
                    const idx = prev.findIndex(
                        (s) => s.date === today && s.app === app,
                    )
                    if (idx >= 0) {
                        return prev.map((s, i) =>
                            i === idx
                                ? {
                                      ...s,
                                      left_clicks:
                                          s.left_clicks +
                                          (button === 0 ? 1 : 0),
                                      right_clicks:
                                          s.right_clicks +
                                          (button === 1 ? 1 : 0),
                                  }
                                : s,
                        )
                    }
                    return [
                        ...prev,
                        {
                            date: today,
                            app,
                            left_clicks: button === 0 ? 1 : 0,
                            right_clicks: button === 1 ? 1 : 0,
                        },
                    ]
                })
            },
        )

        api.getConfig().then(setCfg)
        api.getAutostart().then(setAutostart)
        api.getStats(365).then(setStats)
        api.getAppStats(90).then(setAppStats)
        api.getAppClickStats(90).then(setClickStats)
        api.getAllTimeCounts().then(setAllTimeCounts)
        api.checkUpdate()
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

        // Listen for background update check result (emitted by Rust at startup)
        const unlistenUpdate = listen<{ current: string; latest: string }>(
            "update_available",
            (e) => {
                setUpdate({
                    status: "available",
                    current: e.payload.current,
                    latest: e.payload.latest,
                })
            },
        )

        return () => {
            unlisten.then((f) => f())
            unlistenClick.then((f) => f())
            unlistenUpdate.then((f) => f())
        }
    }, [])

    const handleInstall = async () => {
        setUpdate({ status: "installing" })
        try {
            await api.installUpdate()
        } catch (e) {
            setUpdate({ status: "error", message: String(e) })
        }
    }

    const handleAutostart = (v: boolean) => {
        setAutostart(v)
        api.setAutostart(v)
    }

    const handleAutoUpdate = (v: boolean) =>
        setCfg((c) => (c ? { ...c, auto_update: v } : c))

    const handleSave = async () => {
        if (!cfg) return
        await api.saveConfig(cfg)
        setSaved(true)
        setTimeout(() => setSaved(false), 1500)
    }

    const setSync = (patch: Partial<Config["sync"]>) =>
        setCfg((c) => (c ? { ...c, sync: { ...c.sync, ...patch } } : c))
    const setWs = (patch: Partial<Config["websocket"]>) =>
        setCfg((c) =>
            c ? { ...c, websocket: { ...c.websocket, ...patch } } : c,
        )

    if (!cfg) return null

    const showSave = active !== "statistics" && active !== "about"

    return (
        <div className="flex flex-col h-screen bg-zinc-100 font-sans select-none overflow-hidden rounded-xl">
            <TitleBar />

            <div className="flex flex-1 min-h-0">
                {/* Sidebar */}
                <aside className="w-44 flex flex-col border-r border-zinc-200 bg-zinc-50/80 shrink-0">
                    {/* Nav */}
                    <nav className="flex flex-col gap-0.5 p-2 mt-2">
                        {NAV_ITEMS.map((item) => {
                            const Icon = item.icon
                            const isActive = active === item.id
                            return (
                                <button
                                    key={item.id}
                                    type="button"
                                    onClick={() => setActive(item.id)}
                                    className={cn(
                                        "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-left w-full transition-colors",
                                        isActive
                                            ? "bg-indigo-500 text-white shadow-sm"
                                            : "text-zinc-600 hover:bg-zinc-200/70",
                                    )}
                                >
                                    <Icon className="h-3.5 w-3.5 shrink-0" />
                                    <span className="flex-1">{item.label}</span>
                                    {item.id === "about" &&
                                        update.status === "available" && (
                                            <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                                        )}
                                </button>
                            )
                        })}
                    </nav>
                </aside>

                {/* Content */}
                <main className="flex flex-col flex-1 min-w-0">
                    <div className="flex-1 overflow-y-auto p-5">
                        {active === "statistics" && (
                            <StatisticsSection
                                stats={stats}
                                appStats={appStats}
                                clickStats={clickStats}
                                allTimeCounts={allTimeCounts}
                            />
                        )}
                        {active === "general" && cfg && (
                            <GeneralSection
                                autostart={autostart}
                                cfg={cfg}
                                onAutostart={handleAutostart}
                                onFlushInterval={(v) =>
                                    setCfg((c) =>
                                        c
                                            ? {
                                                  ...c,
                                                  flush_interval_secs:
                                                      Number(v),
                                              }
                                            : c,
                                    )
                                }
                            />
                        )}
                        {active === "sync" && cfg && (
                            <SyncSection cfg={cfg} onUpdate={setSync} />
                        )}
                        {active === "websocket" && cfg && (
                            <WebSocketSection cfg={cfg} onUpdate={setWs} />
                        )}
                        {active === "about" && cfg && (
                            <AboutSection
                                update={update}
                                cfg={cfg}
                                onInstall={handleInstall}
                                onAutoUpdate={handleAutoUpdate}
                            />
                        )}
                    </div>

                    {showSave && (
                        <>
                            <Separator />
                            <div className="flex flex-col gap-2 p-4">
                                {(active === "sync" ||
                                    active === "websocket") && (
                                    <p className="text-[11px] text-zinc-400 text-center leading-snug">
                                        URL and connection settings take effect
                                        after restart.
                                    </p>
                                )}
                                <Button
                                    size="full"
                                    variant={saved ? "success" : "default"}
                                    onClick={handleSave}
                                >
                                    {saved ? "Saved ✓" : "Save"}
                                </Button>
                            </div>
                        </>
                    )}
                </main>
            </div>
        </div>
    )
}

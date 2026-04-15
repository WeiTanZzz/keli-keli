import { listen } from "@tauri-apps/api/event"
import { BarChart2, Globe, Info, Settings2, Zap } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { type AppStat, api, type Config, type DayStat } from "@/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

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

// ─── Stats helpers ────────────────────────────────────────────────────────────

function computeAppTotals(
    appStats: AppStat[],
): { app: string; count: number }[] {
    const totals = new Map<string, number>()
    for (const s of appStats) {
        totals.set(s.app, (totals.get(s.app) ?? 0) + s.count)
    }
    return Array.from(totals.entries())
        .map(([app, count]) => ({ app, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10)
}

function computeStreak(stats: DayStat[]): number {
    const dateMap = new Map(stats.map((s) => [s.date, s.count]))
    let streak = 0
    const d = new Date()
    while (true) {
        const key = d.toISOString().slice(0, 10)
        if ((dateMap.get(key) ?? 0) > 0) {
            streak++
            d.setDate(d.getDate() - 1)
        } else {
            break
        }
    }
    return streak
}

function computeDayOfWeekAvg(
    stats: DayStat[],
): { label: string; avg: number }[] {
    const labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    const sums = new Array(7).fill(0)
    const counts = new Array(7).fill(0)
    for (const s of stats) {
        if (s.count === 0) continue
        const dow = (new Date(`${s.date}T12:00:00`).getDay() + 6) % 7
        sums[dow] += s.count
        counts[dow]++
    }
    return labels.map((label, i) => ({
        label,
        avg: counts[i] > 0 ? Math.round(sums[i] / counts[i]) : 0,
    }))
}

// ─── Chart components ─────────────────────────────────────────────────────────

function getAppColor(app: string): string {
    const colors = [
        "bg-blue-400",
        "bg-emerald-400",
        "bg-purple-400",
        "bg-orange-400",
        "bg-pink-400",
        "bg-teal-400",
        "bg-amber-400",
        "bg-red-400",
        "bg-cyan-400",
        "bg-indigo-400",
    ]
    let hash = 0
    for (let i = 0; i < app.length; i++) {
        hash = (hash * 31 + app.charCodeAt(i)) & 0x7fffffff
    }
    return colors[hash % colors.length]
}

// Cache Simple Icons CDN results in localStorage (boolean per slug)
const ICON_CACHE_KEY = "kk-icon-cache-v1"
const iconCache: Record<string, boolean> = (() => {
    try {
        return JSON.parse(localStorage.getItem(ICON_CACHE_KEY) ?? "{}")
    } catch {
        return {}
    }
})()
function saveIconCache(slug: string, ok: boolean) {
    iconCache[slug] = ok
    try {
        localStorage.setItem(ICON_CACHE_KEY, JSON.stringify(iconCache))
    } catch {}
}

function AppIcon({ app }: { app: string }) {
    const slug = app.toLowerCase().replace(/\s+/g, "")
    // macOS system icon (base64 PNG), null = not found, undefined = loading
    const [macSrc, setMacSrc] = useState<string | null | undefined>(undefined)
    // Simple Icons CDN fallback state
    const [simpleFailed, setSimpleFailed] = useState(iconCache[slug] === false)

    useEffect(() => {
        api.getAppIcon(app)
            .then((b64) =>
                setMacSrc(b64 ? `data:image/png;base64,${b64}` : null),
            )
            .catch(() => setMacSrc(null))
    }, [app])

    const letterFallback = (
        <div
            className={cn(
                "w-5 h-5 rounded-md flex items-center justify-center text-white text-[10px] font-bold shrink-0",
                getAppColor(app),
            )}
        >
            {app.charAt(0).toUpperCase()}
        </div>
    )

    // System icon available — best quality
    if (macSrc) {
        return (
            <img
                src={macSrc}
                alt={app}
                className="w-5 h-5 rounded-md shrink-0 object-contain"
            />
        )
    }

    // Still loading macOS icon: show letter avatar as placeholder
    if (macSrc === undefined) return letterFallback

    // macOS returned nothing — try Simple Icons CDN
    if (!simpleFailed) {
        return (
            <img
                src={`https://cdn.simpleicons.org/${slug}`}
                alt={app}
                className="w-5 h-5 rounded-md shrink-0 object-contain"
                onLoad={() => saveIconCache(slug, true)}
                onError={() => {
                    setSimpleFailed(true)
                    saveIconCache(slug, false)
                }}
            />
        )
    }

    // Nothing worked — letter avatar
    return letterFallback
}

function DailyBarChart({
    stats,
    selectedDate,
    onSelectDate,
}: {
    stats: DayStat[]
    selectedDate: string | null
    onSelectDate: (date: string | null) => void
}) {
    const recent = useMemo(() => stats.slice(-30), [stats])
    const max = useMemo(
        () => Math.max(...recent.map((s) => s.count), 1),
        [recent],
    )
    const today = new Date().toISOString().slice(0, 10)
    const displayDate = selectedDate ?? today

    return (
        <div className="flex flex-col gap-1.5">
            {/* Bars */}
            <div className="flex items-end gap-0.5 h-20">
                {recent.map((s) => {
                    const pct = (s.count / max) * 100
                    const isToday = s.date === today
                    const isSelected = s.date === displayDate
                    const dow = new Date(`${s.date}T12:00:00`).getDay()
                    const isWeekend = dow === 0 || dow === 6
                    return (
                        <div
                            key={s.date}
                            className="flex flex-1 flex-col justify-end h-full group cursor-pointer"
                            onClick={() =>
                                onSelectDate(
                                    s.date === selectedDate ? null : s.date,
                                )
                            }
                        >
                            <div
                                className={cn(
                                    "w-full rounded-sm transition-all duration-150",
                                    isSelected
                                        ? "opacity-100"
                                        : "opacity-60 group-hover:opacity-90",
                                    isToday
                                        ? "bg-indigo-500"
                                        : isSelected
                                          ? "bg-zinc-500"
                                          : isWeekend
                                            ? "bg-zinc-300"
                                            : "bg-zinc-200",
                                )}
                                style={{
                                    height: `${pct}%`,
                                    minHeight: s.count ? 2 : 0,
                                }}
                            />
                        </div>
                    )
                })}
            </div>

            {/* Date labels — sparse: first, every 7, last */}
            <div className="flex items-start gap-0.5">
                {recent.map((s, i) => {
                    const showLabel =
                        i === 0 || i === recent.length - 1 || i % 7 === 0
                    return (
                        <div key={s.date} className="flex-1 text-center">
                            {showLabel && (
                                <span
                                    className={cn(
                                        "text-[9px] leading-none",
                                        s.date === displayDate
                                            ? "text-indigo-500 font-medium"
                                            : "text-zinc-400",
                                    )}
                                >
                                    {s.date.slice(5)}
                                </span>
                            )}
                        </div>
                    )
                })}
            </div>
        </div>
    )
}

function DayOfWeekChart({ stats }: { stats: DayStat[] }) {
    const dowData = useMemo(() => computeDayOfWeekAvg(stats), [stats])
    const max = useMemo(
        () => Math.max(...dowData.map((d) => d.avg), 1),
        [dowData],
    )
    return (
        <div className="flex flex-col gap-2">
            {dowData.map(({ label, avg }) => (
                <div key={label} className="flex items-center gap-2.5">
                    <span className="text-[11px] text-zinc-400 w-7 shrink-0">
                        {label}
                    </span>
                    <div className="flex-1 h-2.5 bg-zinc-100 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-indigo-400 rounded-full transition-all duration-500"
                            style={{ width: `${(avg / max) * 100}%` }}
                        />
                    </div>
                    <span className="text-[11px] text-zinc-400 w-14 text-right tabular-nums">
                        {avg > 0 ? avg.toLocaleString() : "—"}
                    </span>
                </div>
            ))}
        </div>
    )
}

type AppPeriod = "day" | "week" | "all"

function AppBreakdownChart({ appStats }: { appStats: AppStat[] }) {
    const [period, setPeriod] = useState<AppPeriod>("all")

    const filteredStats = useMemo(() => {
        const today = new Date().toISOString().slice(0, 10)
        if (period === "day") {
            return appStats.filter((s) => s.date === today)
        }
        if (period === "week") {
            const weekAgo = new Date(Date.now() - 7 * 86400000)
                .toISOString()
                .slice(0, 10)
            return appStats.filter((s) => s.date >= weekAgo)
        }
        return appStats
    }, [appStats, period])

    const data = useMemo(
        () => computeAppTotals(filteredStats),
        [filteredStats],
    )
    const max = Math.max(...data.map((d) => d.count), 1)

    const periods: { id: AppPeriod; label: string }[] = [
        { id: "day", label: "Today" },
        { id: "week", label: "Week" },
        { id: "all", label: "All" },
    ]

    return (
        <div className="flex flex-col gap-3">
            {/* Period selector */}
            <div className="flex gap-1">
                {periods.map(({ id, label }) => (
                    <button
                        key={id}
                        type="button"
                        onClick={() => setPeriod(id)}
                        className={cn(
                            "px-2.5 py-0.5 text-[11px] rounded-full transition-colors",
                            period === id
                                ? "bg-indigo-500 text-white font-medium"
                                : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200",
                        )}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {data.length === 0 ? (
                <p className="text-xs text-zinc-400 text-center py-1">
                    No data yet — start typing!
                </p>
            ) : (
                <div className="flex flex-col gap-2">
                    {data.map(({ app, count }) => (
                        <div key={app} className="flex items-center gap-2.5">
                            <AppIcon app={app} />
                            <span
                                className="text-[11px] text-zinc-500 w-20 truncate shrink-0"
                                title={app}
                            >
                                {app}
                            </span>
                            <div className="flex-1 h-2.5 bg-zinc-100 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-indigo-400 rounded-full transition-all duration-500"
                                    style={{ width: `${(count / max) * 100}%` }}
                                />
                            </div>
                            <span className="text-[11px] text-zinc-400 w-14 text-right tabular-nums">
                                {count.toLocaleString()}
                            </span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}

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
        <div className="flex flex-col gap-1 p-3">
            <span className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider">
                {label}
            </span>
            <span className="text-xl font-bold text-zinc-800 tabular-nums leading-none">
                {value}
            </span>
            {sub && (
                <span className="text-[10px] text-zinc-400 leading-none">
                    {sub}
                </span>
            )}
        </div>
    )
}

// ─── Form helpers ─────────────────────────────────────────────────────────────

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
        <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
            {children}
        </h2>
    )
}

// ─── Sections ─────────────────────────────────────────────────────────────────

function StatisticsSection({
    stats,
    appStats,
}: {
    stats: DayStat[]
    appStats: AppStat[]
}) {
    const [selectedDate, setSelectedDate] = useState<string | null>(null)
    const today = new Date().toISOString().slice(0, 10)
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)

    const todayCount = useMemo(
        () => stats.find((s) => s.date === today)?.count ?? 0,
        [stats, today],
    )
    const yesterdayCount = useMemo(
        () => stats.find((s) => s.date === yesterday)?.count ?? 0,
        [stats, yesterday],
    )

    // Hero: show selected date's data (or today if none selected)
    const isViewingToday = selectedDate === null || selectedDate === today
    const heroCount = useMemo(() => {
        if (isViewingToday) return todayCount
        return stats.find((s) => s.date === selectedDate)?.count ?? 0
    }, [stats, selectedDate, isViewingToday, todayCount])

    // Compare selected date vs today; or today vs yesterday
    const trendPct = useMemo(() => {
        if (isViewingToday) {
            return yesterdayCount > 0
                ? Math.round(
                      ((todayCount - yesterdayCount) / yesterdayCount) * 100,
                  )
                : null
        }
        return todayCount > 0
            ? Math.round(((heroCount - todayCount) / todayCount) * 100)
            : null
    }, [isViewingToday, todayCount, yesterdayCount, heroCount])

    const heroLabel = isViewingToday
        ? "keystrokes today"
        : `keystrokes · ${selectedDate}`

    const daysWithData = useMemo(
        () => stats.filter((s) => s.count > 0),
        [stats],
    )
    const avgCount = useMemo(
        () =>
            daysWithData.length > 0
                ? Math.round(
                      daysWithData.reduce((sum, s) => sum + s.count, 0) /
                          daysWithData.length,
                  )
                : 0,
        [daysWithData],
    )
    const bestDay = useMemo(
        () =>
            stats.reduce((best, s) => (s.count > best.count ? s : best), {
                date: "",
                count: 0,
            }),
        [stats],
    )
    const streak = useMemo(() => computeStreak(stats), [stats])
    const allTimeTotal = useMemo(
        () => stats.reduce((sum, s) => sum + s.count, 0),
        [stats],
    )

    return (
        <div className="flex flex-col gap-4">
            <SectionTitle>Statistics</SectionTitle>

            {/* Hero + 30-day chart */}
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
                        selectedDate={selectedDate}
                        onSelectDate={setSelectedDate}
                    />
                </div>
            </Card>

            {/* Stat chips */}
            <Card>
                <div className="grid grid-cols-2 divide-x divide-zinc-100">
                    <StatChip
                        label="Daily avg"
                        value={avgCount.toLocaleString()}
                        sub="keystrokes"
                    />
                    <StatChip
                        label="Best day"
                        value={bestDay.count.toLocaleString()}
                        sub={bestDay.date ? bestDay.date.slice(5) : undefined}
                    />
                </div>
                <div className="grid grid-cols-2 divide-x divide-zinc-100 border-t border-zinc-100">
                    <StatChip
                        label="Streak"
                        value={streak > 0 ? `${streak}d` : "—"}
                        sub={streak > 0 ? "in a row" : "no streak"}
                    />
                    <StatChip
                        label="All time"
                        value={
                            allTimeTotal >= 1_000_000
                                ? `${(allTimeTotal / 1_000_000).toFixed(1)}M`
                                : allTimeTotal >= 1_000
                                  ? `${(allTimeTotal / 1_000).toFixed(1)}K`
                                  : allTimeTotal.toLocaleString()
                        }
                        sub="keystrokes"
                    />
                </div>
            </Card>

            {/* Day-of-week pattern */}
            <div className="flex flex-col gap-2">
                <SectionTitle>By Day of Week</SectionTitle>
                <Card>
                    <div className="px-4 py-3">
                        <DayOfWeekChart stats={stats} />
                    </div>
                </Card>
            </div>

            {/* App breakdown */}
            <div className="flex flex-col gap-2">
                <SectionTitle>By App</SectionTitle>
                <Card>
                    <div className="px-4 py-3">
                        <AppBreakdownChart appStats={appStats} />
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
    onInstall,
}: {
    update: UpdateState
    onInstall: () => void
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
            </Card>
        </div>
    )
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function Settings() {
    const [cfg, setCfg] = useState<Config | null>(null)
    const [autostart, setAutostart] = useState(false)
    const [stats, setStats] = useState<DayStat[]>([])
    const [appStats, setAppStats] = useState<AppStat[]>([])
    const [saved, setSaved] = useState(false)
    const [update, setUpdate] = useState<UpdateState>({ status: "checking" })
    const [active, setActive] = useState<NavId>("statistics")

    useEffect(() => {
        const today = new Date().toISOString().slice(0, 10)
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

        api.getConfig().then(setCfg)
        api.getAutostart().then(setAutostart)
        api.getStats(90).then(setStats)
        api.getAppStats(90).then(setAppStats)
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

        return () => {
            unlisten.then((f) => f())
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
        <div className="flex h-screen bg-zinc-100 font-sans select-none overflow-hidden">
            {/* Sidebar */}
            <aside className="w-44 flex flex-col border-r border-zinc-200 bg-zinc-50/80 shrink-0">
                {/* Logo */}
                <div className="flex items-center gap-2 px-4 py-4">
                    <span className="text-lg">⌨️</span>
                    <span className="font-semibold text-sm text-zinc-800">
                        KeliKeli
                    </span>
                </div>

                <Separator />

                {/* Nav */}
                <nav className="flex flex-col gap-0.5 p-2 mt-1">
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
                                {item.label}
                            </button>
                        )
                    })}
                </nav>
            </aside>

            {/* Content */}
            <main className="flex flex-col flex-1 min-w-0">
                <div className="flex-1 overflow-y-auto p-5">
                    {active === "statistics" && (
                        <StatisticsSection stats={stats} appStats={appStats} />
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
                                              flush_interval_secs: Number(v),
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
                    {active === "about" && (
                        <AboutSection
                            update={update}
                            onInstall={handleInstall}
                        />
                    )}
                </div>

                {showSave && (
                    <>
                        <Separator />
                        <div className="p-4">
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
    )
}

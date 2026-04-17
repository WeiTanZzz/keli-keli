import { useMemo, useState } from "react"
import type {
    AllTimeCounts,
    AppClickStat,
    AppStat,
    Config,
    DayStat,
} from "@/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { AppBreakdownChart, DailyBarChart, Last7DaysChart } from "./charts"
import { computeStreak, localDateStr } from "./helpers"
import { Card, FormRow, SectionTitle, StatChip } from "./ui"

// ─── StatisticsSection ────────────────────────────────────────────────────────

export function StatisticsSection({
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
                                            className={
                                                trendPct >= 0
                                                    ? "text-xs font-medium tabular-nums text-emerald-500"
                                                    : "text-xs font-medium tabular-nums text-red-400"
                                            }
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

// ─── GeneralSection ───────────────────────────────────────────────────────────

export function GeneralSection({
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

// ─── SyncSection ──────────────────────────────────────────────────────────────

export function SyncSection({
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

// ─── WebSocketSection ─────────────────────────────────────────────────────────

export function WebSocketSection({
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

// ─── AboutSection ─────────────────────────────────────────────────────────────

export type UpdateState =
    | { status: "checking" }
    | { status: "latest"; version: string }
    | { status: "available"; current: string; latest: string }
    | { status: "installing" }
    | { status: "error"; message: string }

export function AboutSection({
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

import { useMemo, useState } from "react"
import type {
    AllTimeCounts,
    AppClickStat,
    AppStat,
    Config,
    DayStat,
    IndicatorConfig,
} from "@/api"
import { Button } from "@/components/ui/button"
import { Calendar, type DateRange } from "@/components/ui/calendar"
import { Input } from "@/components/ui/input"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { AppBreakdownRows, DailyBarChart, TodayByApp } from "./charts"
import { computeStreak, localDateStr } from "./helpers"
import { Card, FormRow, SectionTitle, StatChip } from "./ui"

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmtNum(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
    return n.toLocaleString()
}

// Build a local-midnight Date from a YYYY-MM-DD string.
// Using `new Date(s)` would parse as UTC midnight and shift the date for
// users behind UTC. The constructor `new Date(y, m, d)` uses local time.
function dateFromStr(s: string): Date {
    const [y, m, d] = s.split("-").map(Number)
    return new Date(y, m - 1, d)
}

function fmtDisplay(s: string): string {
    return dateFromStr(s).toLocaleDateString("en", {
        month: "short",
        day: "numeric",
    })
}

type Preset = "7d" | "30d" | "90d"

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
    const today = localDateStr()
    const yesterday = localDateStr(new Date(Date.now() - 86400000))

    // ── Today ──────────────────────────────────────────────────────────────────
    const todayKeys = stats.find((s) => s.date === today)?.count ?? 0

    const { todayLeft, todayRight } = useMemo(() => {
        let left = 0
        let right = 0
        for (const s of clickStats) {
            if (s.date === today) {
                left += s.left_clicks
                right += s.right_clicks
            }
        }
        return { todayLeft: left, todayRight: right }
    }, [clickStats, today])

    const todayClicks = todayLeft + todayRight
    const todayTotal = todayKeys + todayClicks

    const yesterdayTotal = useMemo(() => {
        const keys = stats.find((s) => s.date === yesterday)?.count ?? 0
        let clicks = 0
        for (const s of clickStats) {
            if (s.date === yesterday) clicks += s.left_clicks + s.right_clicks
        }
        return keys + clicks
    }, [stats, clickStats, yesterday])

    const trendPct =
        yesterdayTotal > 0
            ? Math.round(((todayTotal - yesterdayTotal) / yesterdayTotal) * 100)
            : null

    // ── All-time summary stats (not range-dependent) ───────────────────────────
    const allDailyClicks = useMemo(() => {
        const m = new Map<string, number>()
        for (const s of clickStats) {
            m.set(s.date, (m.get(s.date) ?? 0) + s.left_clicks + s.right_clicks)
        }
        return m
    }, [clickStats])

    const allDailyTotals = useMemo(() => {
        const dates = new Set([
            ...stats.map((s) => s.date),
            ...allDailyClicks.keys(),
        ])
        return Array.from(dates).map((date) => ({
            date,
            total:
                (stats.find((s) => s.date === date)?.count ?? 0) +
                (allDailyClicks.get(date) ?? 0),
        }))
    }, [stats, allDailyClicks])

    const allDaysWithData = allDailyTotals.filter((d) => d.total > 0)
    const allTimeAvg =
        allDaysWithData.length > 0
            ? Math.round(
                  allDaysWithData.reduce((s, d) => s + d.total, 0) /
                      allDaysWithData.length,
              )
            : 0
    const allTimeBestDay = allDailyTotals.reduce(
        (best, d) => (d.total > best.total ? d : best),
        { date: "", total: 0 },
    )
    const streak = useMemo(() => computeStreak(stats), [stats])
    const allTimeTotal = allTimeCounts
        ? allTimeCounts.keystrokes +
          allTimeCounts.left_clicks +
          allTimeCounts.right_clicks
        : null

    // ── Explore range (chart + By App share the same picker) ──────────────────
    const [preset, setPreset] = useState<Preset>("30d")
    const [popoverOpen, setPopoverOpen] = useState(false)

    // appliedRange: active filter. Never touched by partial selections —
    // only set when user completes a full range, or cleared by preset click.
    const [appliedRange, setAppliedRange] = useState<
        { from: Date; to: Date } | undefined
    >(undefined)

    // inProgress: transient calendar state while user is picking the end date.
    // Kept separate so the filter never flickers back to preset mid-selection.
    const [inProgress, setInProgress] = useState<DateRange | undefined>(
        undefined,
    )

    const isCustom = appliedRange != null

    const { startDate, endDate } = useMemo(() => {
        if (appliedRange) {
            return {
                startDate: localDateStr(appliedRange.from),
                endDate: localDateStr(appliedRange.to),
            }
        }
        const days = preset === "7d" ? 7 : preset === "30d" ? 30 : 90
        return {
            startDate: localDateStr(
                new Date(Date.now() - (days - 1) * 86400000),
            ),
            endDate: today,
        }
    }, [appliedRange, preset, today])

    const handlePreset = (p: Preset) => {
        setPreset(p)
        setAppliedRange(undefined)
        setInProgress(undefined)
    }

    const handleCalendarSelect = (range: DateRange | undefined) => {
        setInProgress(range)
        if (range?.from && range?.to) {
            setAppliedRange({ from: range.from, to: range.to })
            setInProgress(undefined)
            setPopoverOpen(false) // auto-close after complete selection
        }
        // Partial (only from clicked): keep appliedRange intact so
        // the chart doesn't flicker while user picks the end date
    }

    // Calendar shows in-progress pick or applied range — never the preset range.
    // Showing the preset as "selected" misleads users into thinking it's a custom pick.
    const calendarDisplay: DateRange | undefined =
        inProgress ??
        (appliedRange ? { from: appliedRange.from, to: appliedRange.to } : undefined)

    const histStats = useMemo(
        () => stats.filter((s) => s.date >= startDate && s.date <= endDate),
        [stats, startDate, endDate],
    )
    const histClicks = useMemo(
        () =>
            clickStats.filter((s) => s.date >= startDate && s.date <= endDate),
        [clickStats, startDate, endDate],
    )
    const histAppStats = useMemo(
        () => appStats.filter((s) => s.date >= startDate && s.date <= endDate),
        [appStats, startDate, endDate],
    )

    const presets: { id: Preset; label: string }[] = [
        { id: "7d", label: "7d" },
        { id: "30d", label: "30d" },
        { id: "90d", label: "90d" },
    ]

    return (
        <div className="flex flex-col gap-6">
            {/* ── Section 1: Today ── */}
            <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                    <SectionTitle>Today</SectionTitle>
                    {trendPct !== null && (
                        <span
                            className={cn(
                                "text-[11px] font-medium",
                                trendPct >= 0
                                    ? "text-emerald-500"
                                    : "text-red-400",
                            )}
                        >
                            {trendPct >= 0 ? "↑" : "↓"}&nbsp;
                            {Math.abs(trendPct)}% vs yesterday
                        </span>
                    )}
                </div>
                <Card>
                    <div className="grid grid-cols-3 divide-x divide-zinc-100">
                        <div className="flex flex-col gap-1 px-4 py-4">
                            <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-widest leading-none">
                                Total
                            </span>
                            <span className="text-3xl font-bold text-zinc-900 tabular-nums leading-tight mt-1">
                                {fmtNum(todayTotal)}
                            </span>
                            <span className="text-[10px] text-zinc-400 mt-0.5">
                                actions today
                            </span>
                        </div>
                        <div className="flex flex-col gap-1 px-4 py-4">
                            <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-widest leading-none">
                                Keystrokes
                            </span>
                            <span className="text-2xl font-bold text-zinc-800 tabular-nums leading-tight mt-1">
                                {fmtNum(todayKeys)}
                            </span>
                            <span className="text-[10px] text-zinc-400 flex items-center gap-1 mt-0.5">
                                <span className="w-1.5 h-1.5 rounded-sm bg-indigo-400 inline-block shrink-0" />
                                keys
                            </span>
                        </div>
                        <div className="flex flex-col gap-1 px-4 py-4">
                            <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-widest leading-none">
                                Clicks
                            </span>
                            <span className="text-2xl font-bold text-zinc-800 tabular-nums leading-tight mt-1">
                                {fmtNum(todayClicks)}
                            </span>
                            <span className="text-[10px] text-zinc-400 flex items-center gap-1 mt-0.5">
                                <span className="w-1.5 h-1.5 rounded-sm bg-rose-400 inline-block shrink-0" />
                                {todayClicks > 0
                                    ? `${todayLeft}L · ${todayRight}R`
                                    : "no clicks"}
                            </span>
                        </div>
                    </div>
                    <div className="px-4 py-3 border-t border-zinc-100">
                        <TodayByApp
                            appStats={appStats}
                            clickStats={clickStats}
                            today={today}
                        />
                    </div>
                </Card>
            </div>

            {/* ── Section 2: Summary (all-time, not range-dependent) ── */}
            <div className="flex flex-col gap-2">
                <SectionTitle>Summary</SectionTitle>
                <Card>
                    <div className="grid grid-cols-4 divide-x divide-zinc-100">
                        <StatChip
                            label="Daily avg"
                            value={fmtNum(allTimeAvg)}
                            sub="actions"
                        />
                        <StatChip
                            label="Best day"
                            value={fmtNum(allTimeBestDay.total)}
                            sub={
                                allTimeBestDay.date
                                    ? allTimeBestDay.date.slice(5)
                                    : undefined
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
                                    : fmtNum(allTimeTotal)
                            }
                            sub="actions"
                        />
                    </div>
                </Card>
            </div>

            {/* ── Section 3: Explore (chart + By App share the same date range) ── */}
            <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                    <SectionTitle>Explore</SectionTitle>
                    {/* Range controls: preset chips + calendar picker */}
                    <div className="flex items-center gap-1.5">
                        {presets.map(({ id, label }) => (
                            <button
                                key={id}
                                type="button"
                                onClick={() => handlePreset(id)}
                                className={cn(
                                    "px-2.5 py-0.5 text-[11px] rounded-full transition-colors",
                                    !isCustom && preset === id
                                        ? "bg-indigo-500 text-white font-medium"
                                        : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200",
                                )}
                            >
                                {label}
                            </button>
                        ))}
                        <Popover
                            open={popoverOpen}
                            onOpenChange={(open) => {
                                setPopoverOpen(open)
                                if (!open) setInProgress(undefined)
                            }}
                        >
                            <PopoverTrigger asChild>
                                <button
                                    type="button"
                                    className={cn(
                                        "px-2.5 py-0.5 text-[11px] rounded-full transition-colors border",
                                        isCustom
                                            ? "bg-indigo-500 text-white font-medium border-indigo-500"
                                            : "bg-white text-zinc-500 border-zinc-200 hover:bg-zinc-50",
                                    )}
                                >
                                    {isCustom
                                        ? `${fmtDisplay(startDate)} – ${fmtDisplay(endDate)}`
                                        : "Custom"}
                                </button>
                            </PopoverTrigger>
                            <PopoverContent align="end" className="p-0">
                                <Calendar
                                    mode="range"
                                    selected={calendarDisplay}
                                    onSelect={handleCalendarSelect}
                                    disabled={(date) => {
                                        if (date > dateFromStr(today)) return true
                                        if (inProgress?.from && !inProgress.to && date < inProgress.from) return true
                                        return false
                                    }}
                                    numberOfMonths={1}
                                />
                            </PopoverContent>
                        </Popover>
                    </div>
                </div>

                <Card>
                    {/* Bar chart */}
                    <div className="px-4 pt-4 pb-3">
                        <DailyBarChart
                            stats={histStats}
                            clickStats={histClicks}
                            rangeStart={startDate}
                            rangeEnd={endDate}
                        />
                    </div>

                    {/* By App — same date range */}
                    <div className="px-4 pt-3 pb-4 border-t border-zinc-100">
                        <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-widest mb-3">
                            By App
                        </p>
                        <AppBreakdownRows
                            appStats={histAppStats}
                            clickStats={histClicks}
                        />
                    </div>
                </Card>
            </div>
        </div>
    )
}

// ─── GeneralSection ───────────────────────────────────────────────────────────

const ICON_PRESETS = ["⌨️", "🖱️", "💻", "⚡", "🔥"]

const BADGE_PRESETS: Record<
    "keystroke" | "left_click" | "right_click",
    string[]
> = {
    keystroke: ["⌨️", "✍️", "💬", "📝", "🔤"],
    left_click: ["👈", "⬅️", "👆", "🤏", "🖱️"],
    right_click: ["👉", "➡️", "⚙️", "📋", "☰"],
}

function BadgeRow({
    label,
    value,
    presets,
    onChange,
}: {
    label: string
    value: string
    presets: string[]
    onChange: (v: string) => void
}) {
    return (
        <FormRow label={label}>
            <div className="flex flex-col gap-2 items-end">
                <Input
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    className="w-20 text-center"
                    maxLength={8}
                />
                <div className="flex gap-1 flex-wrap justify-end">
                    {presets.map((preset) => (
                        <button
                            key={preset}
                            type="button"
                            onClick={() => onChange(preset)}
                            className={`px-2 h-7 rounded text-xs font-medium transition-colors ${
                                value === preset
                                    ? "bg-indigo-100 ring-1 ring-indigo-400 text-indigo-700"
                                    : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200"
                            }`}
                        >
                            {preset}
                        </button>
                    ))}
                </div>
            </div>
        </FormRow>
    )
}

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

// ─── IndicatorSection ─────────────────────────────────────────────────────────

export function IndicatorSection({
    cfg,
    onIndicator,
}: {
    cfg: Config
    onIndicator: (patch: Partial<IndicatorConfig>) => void
}) {
    const ind = cfg.indicator

    return (
        <div className="flex flex-col gap-4">
            <SectionTitle>Indicator</SectionTitle>
            <Card>
                {/* Icon type toggle */}
                <FormRow
                    label="Icon"
                    description="What to show in the floating window"
                >
                    <div className="flex gap-1">
                        {(["emoji", "active_app"] as const).map((t) => (
                            <button
                                key={t}
                                type="button"
                                onClick={() => onIndicator({ icon_type: t })}
                                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                                    ind.icon_type === t
                                        ? "bg-indigo-500 text-white"
                                        : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200"
                                }`}
                            >
                                {t === "emoji" ? "Emoji" : "Active App"}
                            </button>
                        ))}
                    </div>
                </FormRow>

                {/* Emoji picker — only shown when icon_type = "emoji" */}
                {ind.icon_type === "emoji" && (
                    <FormRow
                        label="Emoji"
                        description="Type any emoji or pick a preset"
                    >
                        <div className="flex flex-col gap-2 items-end">
                            <Input
                                value={ind.icon_value}
                                onChange={(e) =>
                                    onIndicator({ icon_value: e.target.value })
                                }
                                className="w-20 text-center text-lg"
                                maxLength={8}
                            />
                            <div className="flex gap-1 flex-wrap justify-end">
                                {ICON_PRESETS.map((emoji) => (
                                    <button
                                        key={emoji}
                                        type="button"
                                        onClick={() =>
                                            onIndicator({ icon_value: emoji })
                                        }
                                        className={`w-7 h-7 rounded text-base flex items-center justify-center transition-colors ${
                                            ind.icon_value === emoji
                                                ? "bg-indigo-100 ring-1 ring-indigo-400"
                                                : "hover:bg-zinc-100"
                                        }`}
                                    >
                                        {emoji}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </FormRow>
                )}
            </Card>

            <SectionTitle>Badges</SectionTitle>
            <Card>
                <BadgeRow
                    label="Keystroke"
                    value={ind.badge_keystroke}
                    presets={BADGE_PRESETS.keystroke}
                    onChange={(v) => onIndicator({ badge_keystroke: v })}
                />
                <BadgeRow
                    label="Left click"
                    value={ind.badge_left_click}
                    presets={BADGE_PRESETS.left_click}
                    onChange={(v) => onIndicator({ badge_left_click: v })}
                />
                <BadgeRow
                    label="Right click"
                    value={ind.badge_right_click}
                    presets={BADGE_PRESETS.right_click}
                    onChange={(v) => onIndicator({ badge_right_click: v })}
                />
            </Card>
        </div>
    )
}

// ─── ConnectionsSection ───────────────────────────────────────────────────────

export function ConnectionsSection({
    cfg,
    stats,
    appStats,
    clickStats,
    onUpdateSync,
    onUpdateWs,
}: {
    cfg: Config
    stats: DayStat[]
    appStats: AppStat[]
    clickStats: AppClickStat[]
    onUpdateSync: (patch: Partial<Config["sync"]>) => void
    onUpdateWs: (patch: Partial<Config["websocket"]>) => void
}) {
    const handleExport = async () => {
        const { save } = await import("@tauri-apps/plugin-dialog")
        const { writeTextFile } = await import("@tauri-apps/plugin-fs")
        const path = await save({
            defaultPath: `kelikeli-export-${new Date().toISOString().slice(0, 10)}.json`,
            filters: [{ name: "JSON", extensions: ["json"] }],
        })
        if (!path) return
        const data = {
            stats,
            appStats,
            clickStats,
            exportedAt: new Date().toISOString(),
        }
        await writeTextFile(path, JSON.stringify(data, null, 2))
    }

    return (
        <div className="flex flex-col gap-6">
            {/* HTTP Sync */}
            <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                    <SectionTitle>HTTP Sync</SectionTitle>
                    <Switch
                        checked={cfg.sync.enabled}
                        onCheckedChange={(v) => onUpdateSync({ enabled: v })}
                    />
                </div>
                {cfg.sync.enabled && (
                    <Card>
                        <FormRow label="API URL">
                            <Input
                                value={cfg.sync.api_url}
                                onChange={(e) =>
                                    onUpdateSync({ api_url: e.target.value })
                                }
                                placeholder="https://..."
                            />
                        </FormRow>
                        <FormRow label="API Key">
                            <Input
                                value={cfg.sync.api_key}
                                onChange={(e) =>
                                    onUpdateSync({ api_key: e.target.value })
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
                                    onUpdateSync({
                                        interval_secs: Number(e.target.value),
                                    })
                                }
                            />
                        </FormRow>
                    </Card>
                )}
            </div>

            {/* WebSocket */}
            <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                    <SectionTitle>WebSocket</SectionTitle>
                    <Switch
                        checked={cfg.websocket.enabled}
                        onCheckedChange={(v) => onUpdateWs({ enabled: v })}
                    />
                </div>
                {cfg.websocket.enabled && (
                    <Card>
                        <FormRow label="WS URL">
                            <Input
                                value={cfg.websocket.ws_url}
                                onChange={(e) =>
                                    onUpdateWs({ ws_url: e.target.value })
                                }
                                placeholder="wss://..."
                            />
                        </FormRow>
                        <FormRow label="Idle timeout (ms)">
                            <Input
                                type="number"
                                value={cfg.websocket.typing_idle_ms}
                                onChange={(e) =>
                                    onUpdateWs({
                                        typing_idle_ms: Number(e.target.value),
                                    })
                                }
                            />
                        </FormRow>
                    </Card>
                )}
            </div>

            {/* Export */}
            <div className="flex flex-col gap-3">
                <SectionTitle>Export</SectionTitle>
                <Card>
                    <FormRow
                        label="Export data"
                        description="Download all your stats as JSON"
                    >
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={handleExport}
                        >
                            Export
                        </Button>
                    </FormRow>
                </Card>
            </div>
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

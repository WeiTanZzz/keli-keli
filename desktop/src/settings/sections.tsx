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
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { type Lang, useT } from "@/i18n"
import { AppBreakdownRows, DailyBarChart, TodayByApp } from "./charts"
import { computeStreak, localDateStr } from "./helpers"
import { Card, FormRow, SectionTitle, StatChip } from "./ui"

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmtNum(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
    return n.toLocaleString()
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
    const { t } = useT()
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

    // ── Explore range ─────────────────────────────────────────────────────────
    const [preset, setPreset] = useState<Preset>("30d")

    const { startDate, endDate } = useMemo(() => {
        const days = preset === "7d" ? 7 : preset === "30d" ? 30 : 90
        return {
            startDate: localDateStr(
                new Date(Date.now() - (days - 1) * 86400000),
            ),
            endDate: today,
        }
    }, [preset, today])

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
                    <SectionTitle>{t.stats.today}</SectionTitle>
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
                            {Math.abs(trendPct)}% {t.stats.vsYesterday}
                        </span>
                    )}
                </div>
                <Card>
                    <div className="grid grid-cols-3 divide-x divide-zinc-100">
                        <div className="flex flex-col gap-1 px-4 py-4">
                            <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-widest leading-none">
                                {t.stats.total}
                            </span>
                            <span className="text-3xl font-bold text-zinc-900 tabular-nums leading-tight mt-1">
                                {fmtNum(todayTotal)}
                            </span>
                            <span className="text-[10px] text-zinc-400 mt-0.5">
                                {t.stats.actionsToday}
                            </span>
                        </div>
                        <div className="flex flex-col gap-1 px-4 py-4">
                            <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-widest leading-none">
                                {t.stats.keystrokes}
                            </span>
                            <span className="text-2xl font-bold text-zinc-800 tabular-nums leading-tight mt-1">
                                {fmtNum(todayKeys)}
                            </span>
                            <span className="text-[10px] text-zinc-400 flex items-center gap-1 mt-0.5">
                                <span className="w-1.5 h-1.5 rounded-sm bg-indigo-400 inline-block shrink-0" />
                                {t.stats.keys}
                            </span>
                        </div>
                        <div className="flex flex-col gap-1 px-4 py-4">
                            <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-widest leading-none">
                                {t.stats.clicks}
                            </span>
                            <span className="text-2xl font-bold text-zinc-800 tabular-nums leading-tight mt-1">
                                {fmtNum(todayClicks)}
                            </span>
                            <span className="text-[10px] text-zinc-400 flex items-center gap-1 mt-0.5">
                                <span className="w-1.5 h-1.5 rounded-sm bg-rose-400 inline-block shrink-0" />
                                {todayClicks > 0
                                    ? `${todayLeft}L · ${todayRight}R`
                                    : t.stats.noClicks}
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
                <SectionTitle>{t.stats.summary}</SectionTitle>
                <Card>
                    <div className="grid grid-cols-4 divide-x divide-zinc-100">
                        <StatChip
                            label={t.stats.dailyAvg}
                            value={fmtNum(allTimeAvg)}
                            sub={t.stats.actions}
                        />
                        <StatChip
                            label={t.stats.bestDay}
                            value={fmtNum(allTimeBestDay.total)}
                            sub={
                                allTimeBestDay.date
                                    ? allTimeBestDay.date.slice(5)
                                    : undefined
                            }
                        />
                        <StatChip
                            label={t.stats.streak}
                            value={streak > 0 ? `${streak}d` : "—"}
                            sub={streak > 0 ? t.stats.inARow : t.stats.noStreak}
                        />
                        <StatChip
                            label={t.stats.allTime}
                            value={
                                allTimeTotal === null
                                    ? "—"
                                    : fmtNum(allTimeTotal)
                            }
                            sub={t.stats.actions}
                        />
                    </div>
                </Card>
            </div>

            {/* ── Section 3: Explore (chart + By App share the same date range) ── */}
            <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                    <SectionTitle>{t.stats.explore}</SectionTitle>
                    {/* Range controls: preset chips + calendar picker */}
                    <div className="flex items-center gap-1.5">
                        {presets.map(({ id, label }) => (
                            <button
                                key={id}
                                type="button"
                                onClick={() => setPreset(id)}
                                className={cn(
                                    "px-2.5 py-0.5 text-[11px] rounded-full transition-colors",
                                    preset === id
                                        ? "bg-indigo-500 text-white font-medium"
                                        : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200",
                                )}
                            >
                                {label}
                            </button>
                        ))}
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
                            {t.stats.byApp}
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
    const { t, lang, setLang } = useT()
    return (
        <div className="flex flex-col gap-4">
            <SectionTitle>{t.general.title}</SectionTitle>
            <Card>
                <FormRow
                    label={t.general.language}
                    description={t.general.languageDesc}
                >
                    <div className="flex gap-1">
                        {(["en", "zh"] as Lang[]).map((l) => (
                            <button
                                key={l}
                                type="button"
                                onClick={() => setLang(l)}
                                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                                    lang === l
                                        ? "bg-indigo-500 text-white"
                                        : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200"
                                }`}
                            >
                                {t.lang[l]}
                            </button>
                        ))}
                    </div>
                </FormRow>
                <FormRow
                    label={t.general.launchAtStartup}
                    description={t.general.launchDesc}
                >
                    <Switch checked={autostart} onCheckedChange={onAutostart} />
                </FormRow>
                <FormRow
                    label={t.general.flushInterval}
                    description={t.general.flushDesc}
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
    const { t } = useT()
    const ind = cfg.indicator

    return (
        <div className="flex flex-col gap-4">
            <SectionTitle>{t.indicator.title}</SectionTitle>
            <Card>
                {/* Icon type toggle */}
                <FormRow
                    label={t.indicator.icon}
                    description={t.indicator.iconDesc}
                >
                    <div className="flex gap-1">
                        {(["emoji", "active_app"] as const).map((type) => (
                            <button
                                key={type}
                                type="button"
                                onClick={() => onIndicator({ icon_type: type })}
                                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                                    ind.icon_type === type
                                        ? "bg-indigo-500 text-white"
                                        : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200"
                                }`}
                            >
                                {type === "emoji" ? t.indicator.emoji : t.indicator.activeApp}
                            </button>
                        ))}
                    </div>
                </FormRow>

                {/* Emoji picker — only shown when icon_type = "emoji" */}
                {ind.icon_type === "emoji" && (
                    <FormRow
                        label={t.indicator.emojiLabel}
                        description={t.indicator.emojiDesc}
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

            <SectionTitle>{t.indicator.badges}</SectionTitle>
            <Card>
                <BadgeRow
                    label={t.indicator.keystroke}
                    value={ind.badge_keystroke}
                    presets={BADGE_PRESETS.keystroke}
                    onChange={(v) => onIndicator({ badge_keystroke: v })}
                />
                <BadgeRow
                    label={t.indicator.leftClick}
                    value={ind.badge_left_click}
                    presets={BADGE_PRESETS.left_click}
                    onChange={(v) => onIndicator({ badge_left_click: v })}
                />
                <BadgeRow
                    label={t.indicator.rightClick}
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

    const { t } = useT()

    return (
        <div className="flex flex-col gap-6">
            {/* HTTP Sync */}
            <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                    <SectionTitle>{t.connections.httpSync}</SectionTitle>
                    <Switch
                        checked={cfg.sync.enabled}
                        onCheckedChange={(v) => onUpdateSync({ enabled: v })}
                    />
                </div>
                {cfg.sync.enabled && (
                    <Card>
                        <FormRow label={t.connections.apiUrl}>
                            <Input
                                value={cfg.sync.api_url}
                                onChange={(e) =>
                                    onUpdateSync({ api_url: e.target.value })
                                }
                                placeholder="https://..."
                            />
                        </FormRow>
                        <FormRow label={t.connections.apiKey}>
                            <Input
                                value={cfg.sync.api_key}
                                onChange={(e) =>
                                    onUpdateSync({ api_key: e.target.value })
                                }
                                placeholder="sk-..."
                                type="password"
                            />
                        </FormRow>
                        <FormRow label={t.connections.syncInterval}>
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
                    <SectionTitle>{t.connections.websocket}</SectionTitle>
                    <Switch
                        checked={cfg.websocket.enabled}
                        onCheckedChange={(v) => onUpdateWs({ enabled: v })}
                    />
                </div>
                {cfg.websocket.enabled && (
                    <Card>
                        <FormRow label={t.connections.wsUrl}>
                            <Input
                                value={cfg.websocket.ws_url}
                                onChange={(e) =>
                                    onUpdateWs({ ws_url: e.target.value })
                                }
                                placeholder="wss://..."
                            />
                        </FormRow>
                        <FormRow label={t.connections.idleTimeout}>
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
                <SectionTitle>{t.connections.export}</SectionTitle>
                <Card>
                    <FormRow
                        label={t.connections.exportData}
                        description={t.connections.exportDesc}
                    >
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={handleExport}
                        >
                            {t.btn.export}
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
    | { status: "error"; message?: string }

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
    const { t } = useT()
    return (
        <div className="flex flex-col gap-4">
            <SectionTitle>{t.about.title}</SectionTitle>
            <Card>
                <FormRow label={t.about.version}>
                    {update.status === "checking" && (
                        <span className="text-xs text-zinc-400">{t.about.checking}</span>
                    )}
                    {update.status === "latest" && (
                        <span className="text-xs text-zinc-400">
                            v{update.version} · {t.about.upToDate}
                        </span>
                    )}
                    {update.status === "available" && (
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-zinc-400">
                                v{update.current}
                            </span>
                            <Button size="sm" onClick={onInstall}>
                                {t.about.updateTo} v{update.latest}
                            </Button>
                        </div>
                    )}
                    {update.status === "installing" && (
                        <span className="text-xs text-indigo-500">
                            {t.about.installing}
                        </span>
                    )}
                    {update.status === "error" && (
                        <span className="text-xs text-red-500">
                            {update.message ?? t.about.errorServer}
                        </span>
                    )}
                </FormRow>
                <FormRow
                    label={t.about.autoUpdate}
                    description={t.about.autoUpdateDesc}
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

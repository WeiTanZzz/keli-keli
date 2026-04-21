import { useMemo, useState } from "react"
import type { AppClickStat, AppStat, DayStat } from "@/api"
import { cn } from "@/lib/utils"
import { useT } from "@/i18n"
import { AppIcon, useAppDisplayName } from "./AppIcon"
import { computeAppTotals, localDateStr } from "./helpers"
import { Tip } from "./ui"

// ─── AppRow ───────────────────────────────────────────────────────────────────

export function AppRow({
    app,
    keys,
    left,
    right,
    max,
}: {
    app: string
    keys: number
    left: number
    right: number
    max: number
}) {
    const { t } = useT()
    const displayName = useAppDisplayName(app)
    const clicks = left + right
    const total = keys + clicks
    return (
        <Tip
            content={
                <span className="flex gap-2.5">
                    <span className="font-medium">{displayName}</span>
                    {keys > 0 && (
                        <span className="flex items-center gap-1">
                            <span className="inline-block w-1.5 h-1.5 rounded-sm bg-indigo-400" />
                            {keys.toLocaleString()} {t.chart.keys}
                        </span>
                    )}
                    {left > 0 && (
                        <span className="flex items-center gap-1">
                            <span className="inline-block w-1.5 h-1.5 rounded-sm bg-rose-400" />
                            {left.toLocaleString()} L
                        </span>
                    )}
                    {right > 0 && (
                        <span className="flex items-center gap-1">
                            <span className="inline-block w-1.5 h-1.5 rounded-sm bg-rose-600" />
                            {right.toLocaleString()} R
                        </span>
                    )}
                </span>
            }
        >
            <div className="flex items-center gap-2.5">
                <AppIcon app={app} />
                <span
                    className="text-[11px] text-zinc-500 w-20 truncate shrink-0"
                    title={displayName}
                >
                    {displayName}
                </span>
                <div className="flex-1 h-2.5 bg-zinc-100 rounded-full overflow-hidden flex">
                    <div
                        className="h-full bg-indigo-400 transition-all duration-500"
                        style={{ width: `${(keys / max) * 100}%` }}
                    />
                    <div
                        className="h-full bg-rose-400 transition-all duration-500"
                        style={{ width: `${(clicks / max) * 100}%` }}
                    />
                </div>
                <span className="text-[11px] text-zinc-400 w-14 text-right tabular-nums">
                    {total.toLocaleString()}
                </span>
            </div>
        </Tip>
    )
}

// ─── DailyBarChart ────────────────────────────────────────────────────────────

// Iterate every calendar day from rangeStart to rangeEnd (local-timezone-safe).
function buildDateRange(rangeStart: string, rangeEnd: string): string[] {
    const result: string[] = []
    const [sy, sm, sd] = rangeStart.split("-").map(Number)
    const d = new Date(sy, sm - 1, sd)
    while (true) {
        const y = d.getFullYear()
        const m = String(d.getMonth() + 1).padStart(2, "0")
        const day = String(d.getDate()).padStart(2, "0")
        const str = `${y}-${m}-${day}`
        if (str > rangeEnd) break
        result.push(str)
        d.setDate(d.getDate() + 1) // DST-safe: adds one calendar day
    }
    return result
}

export function DailyBarChart({
    stats,
    clickStats,
    rangeStart,
    rangeEnd,
}: {
    stats: DayStat[]
    clickStats: AppClickStat[]
    rangeStart?: string
    rangeEnd?: string
}) {
    const { t } = useT()
    const today = localDateStr()

    const keyMap = useMemo(
        () => new Map(stats.map((s) => [s.date, s.count])),
        [stats],
    )

    const clickMap = useMemo(() => {
        const m = new Map<string, number>()
        for (const s of clickStats) {
            m.set(s.date, (m.get(s.date) ?? 0) + s.left_clicks + s.right_clicks)
        }
        return m
    }, [clickStats])

    // Full date sequence covering rangeStart→rangeEnd (fills gaps with 0-data days)
    const allDates = useMemo(() => {
        const start = rangeStart ?? stats[0]?.date ?? today
        const end = rangeEnd ?? today
        return buildDateRange(start, end)
    }, [rangeStart, rangeEnd, stats, today])

    const dayData = useMemo(
        () =>
            allDates.map((date) => {
                const keys = keyMap.get(date) ?? 0
                const clicks = clickMap.get(date) ?? 0
                return { date, keys, clicks, total: keys + clicks }
            }),
        [allDates, keyMap, clickMap],
    )

    const max = useMemo(
        () => Math.max(...dayData.map((d) => d.total), 1),
        [dayData],
    )

    const [hovered, setHovered] = useState<string | null>(null)
    const infoDate = hovered ?? today
    const info = dayData.find((d) => d.date === infoDate)
    const infoKeys = info?.keys ?? 0
    const infoClicks = info?.clicks ?? 0

    return (
        <div className="flex flex-col gap-1.5">
            {/* Info row */}
            <div className="flex items-center gap-3 h-4 text-[10px]">
                <span className="text-zinc-400 tabular-nums">{infoDate}</span>
                <span className="flex items-center gap-1 text-zinc-500">
                    <span className="inline-block w-1.5 h-1.5 rounded-sm bg-indigo-400" />
                    {infoKeys.toLocaleString()} {t.chart.keys}
                </span>
                {infoClicks > 0 && (
                    <span className="flex items-center gap-1 text-zinc-500">
                        <span className="inline-block w-1.5 h-1.5 rounded-sm bg-rose-400" />
                        {infoClicks.toLocaleString()} {t.chart.clicks}
                    </span>
                )}
            </div>

            {/* Bars — data days are colored, empty days show a 2 px gray stub */}
            <div className="flex items-end gap-0.5 h-20">
                {dayData.map(({ date, keys, clicks, total }) => {
                    const isToday = date === today
                    const isHovered = date === hovered
                    const hasData = total > 0
                    const totalPct = (total / max) * 100
                    const keyFrac = total > 0 ? keys / total : 1

                    return (
                        <div
                            key={date}
                            className="flex flex-1 flex-col justify-end h-full group"
                            onMouseEnter={() => setHovered(date)}
                            onMouseLeave={() => setHovered(null)}
                        >
                            {hasData ? (
                                <div
                                    className={cn(
                                        "w-full rounded-sm overflow-hidden flex flex-col-reverse transition-all duration-100",
                                        isToday || isHovered
                                            ? "opacity-100"
                                            : "opacity-55 group-hover:opacity-100",
                                    )}
                                    style={{
                                        height: `${totalPct}%`,
                                        minHeight: 2,
                                    }}
                                >
                                    <div
                                        className={cn(
                                            "w-full shrink-0",
                                            isToday
                                                ? "bg-indigo-500"
                                                : "bg-indigo-400",
                                        )}
                                        style={{ height: `${keyFrac * 100}%` }}
                                    />
                                    {clicks > 0 && (
                                        <div
                                            className="w-full shrink-0 bg-rose-400"
                                            style={{
                                                height: `${(1 - keyFrac) * 100}%`,
                                            }}
                                        />
                                    )}
                                </div>
                            ) : (
                                /* Empty day: 2 px gray stub */
                                <div
                                    className={cn(
                                        "w-full rounded-sm bg-zinc-200 transition-colors",
                                        isHovered && "bg-zinc-300",
                                    )}
                                    style={{ height: 2 }}
                                />
                            )}
                        </div>
                    )
                })}
            </div>

            {/* Date labels — absolutely positioned so text can extend beyond bar width */}
            <div className="relative h-3.5">
                {(() => {
                    const n = dayData.length
                    const fmt = (date: string) =>
                        t.chart.fmtDate(
                            parseInt(date.slice(5, 7), 10) - 1,
                            parseInt(date.slice(8), 10),
                        )

                    // Build candidate labels then filter by minimum bar-index spacing
                    const candidates: { i: number; text: string }[] = []

                    if (n <= 14) {
                        for (let i = 0; i < dayData.length; i++) {
                            candidates.push({
                                i,
                                text: parseInt(
                                    dayData[i].date.slice(8),
                                    10,
                                ).toString(),
                            })
                        }
                    } else if (n <= 31) {
                        // First + every 7 days
                        dayData.forEach(({ date }, i) => {
                            if (i === 0 || i % 7 === 0)
                                candidates.push({ i, text: fmt(date) })
                        })
                        // Last only if it won't crowd the previous label
                        if (n - 1 - candidates[candidates.length - 1].i >= 4)
                            candidates.push({
                                i: n - 1,
                                text: fmt(dayData[n - 1].date),
                            })
                    } else {
                        // First date
                        candidates.push({ i: 0, text: fmt(dayData[0].date) })
                        // Month starts: just the month name
                        dayData.forEach(({ date }, i) => {
                            if (date.slice(8) === "01")
                                candidates.push({
                                    i,
                                    text: t.chart.fmtMonth(
                                        parseInt(date.slice(5, 7), 10) - 1,
                                    ),
                                })
                        })
                        // Last date only if far enough from the previous label
                        if (n - 1 - candidates[candidates.length - 1].i >= 10)
                            candidates.push({
                                i: n - 1,
                                text: fmt(dayData[n - 1].date),
                            })
                    }

                    return candidates.map(({ i, text }) => (
                        <span
                            key={i}
                            className={cn(
                                "absolute -translate-x-1/2 text-[9px] leading-none whitespace-nowrap",
                                dayData[i].date === today
                                    ? "text-indigo-500 font-medium"
                                    : "text-zinc-400",
                            )}
                            style={{ left: `${((i + 0.5) / n) * 100}%` }}
                        >
                            {text}
                        </span>
                    ))
                })()}
            </div>
        </div>
    )
}

// ─── TodayByApp ───────────────────────────────────────────────────────────────

export function TodayByApp({
    appStats,
    clickStats,
    today,
}: {
    appStats: AppStat[]
    clickStats: AppClickStat[]
    today: string
}) {
    const keyData = useMemo(
        () => computeAppTotals(appStats.filter((s) => s.date === today)),
        [appStats, today],
    )

    const clickData = useMemo(() => {
        const m = new Map<string, { left: number; right: number }>()
        for (const s of clickStats) {
            if (s.date !== today) continue
            const prev = m.get(s.app) ?? { left: 0, right: 0 }
            m.set(s.app, {
                left: prev.left + s.left_clicks,
                right: prev.right + s.right_clicks,
            })
        }
        return m
    }, [clickStats, today])

    const merged = useMemo(() => {
        const all = keyData.map(({ app, count }) => {
            const c = clickData.get(app) ?? { left: 0, right: 0 }
            return { app, keys: count, left: c.left, right: c.right }
        })
        for (const [app, { left, right }] of clickData) {
            if (!all.find((d) => d.app === app)) {
                all.push({ app, keys: 0, left, right })
            }
        }
        return all
            .sort(
                (a, b) =>
                    b.keys + b.left + b.right - (a.keys + a.left + a.right),
            )
            .slice(0, 7)
    }, [keyData, clickData])

    const max = Math.max(...merged.map((d) => d.keys + d.left + d.right), 1)

    const { t } = useT()

    if (merged.length === 0) {
        return (
            <p className="text-xs text-zinc-400 text-center py-1">
                {t.stats.noActivity}
            </p>
        )
    }

    return (
        <div className="flex flex-col gap-2">
            {merged.map(({ app, keys, left, right }) => (
                <AppRow
                    key={app}
                    app={app}
                    keys={keys}
                    left={left}
                    right={right}
                    max={max}
                />
            ))}
        </div>
    )
}

// ─── AppBreakdownRows ─────────────────────────────────────────────────────────
// Renders app rows for pre-filtered data (no internal period selector).

export function AppBreakdownRows({
    appStats,
    clickStats,
}: {
    appStats: AppStat[]
    clickStats: AppClickStat[]
}) {
    const keyData = useMemo(() => computeAppTotals(appStats), [appStats])

    const clickData = useMemo(() => {
        const map = new Map<string, { left: number; right: number }>()
        for (const { app, left_clicks, right_clicks } of clickStats) {
            const prev = map.get(app) ?? { left: 0, right: 0 }
            map.set(app, {
                left: prev.left + left_clicks,
                right: prev.right + right_clicks,
            })
        }
        return map
    }, [clickStats])

    const merged = useMemo(() => {
        const all = keyData.map(({ app, count }) => {
            const c = clickData.get(app) ?? { left: 0, right: 0 }
            return { app, keys: count, left: c.left, right: c.right }
        })
        for (const [app, { left, right }] of clickData) {
            if (!all.find((d) => d.app === app)) {
                all.push({ app, keys: 0, left, right })
            }
        }
        return all
            .sort(
                (a, b) =>
                    b.keys + b.left + b.right - (a.keys + a.left + a.right),
            )
            .slice(0, 10)
    }, [keyData, clickData])

    const max = Math.max(...merged.map((d) => d.keys + d.left + d.right), 1)

    const { t } = useT()

    if (merged.length === 0) {
        return (
            <p className="text-xs text-zinc-400 text-center py-1">
                {t.stats.noData}
            </p>
        )
    }

    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-center justify-end gap-2.5 text-[10px] text-zinc-400">
                <span className="flex items-center gap-1">
                    <span className="inline-block w-2 h-2 rounded-sm bg-indigo-400" />
                    {t.chart.keysLabel}
                </span>
                <span className="flex items-center gap-1">
                    <span className="inline-block w-2 h-2 rounded-sm bg-rose-400" />
                    {t.chart.clicksLabel}
                </span>
            </div>
            <div className="flex flex-col gap-2">
                {merged.map(({ app, keys, left, right }) => (
                    <AppRow
                        key={app}
                        app={app}
                        keys={keys}
                        left={left}
                        right={right}
                        max={max}
                    />
                ))}
            </div>
        </div>
    )
}

// ─── AppBreakdownChart ────────────────────────────────────────────────────────
// Kept for any other usage; has its own internal period selector.

type AppPeriod = "day" | "week" | "all"

export function AppBreakdownChart({
    appStats,
    clickStats,
}: {
    appStats: AppStat[]
    clickStats: AppClickStat[]
}) {
    const { t } = useT()
    const [period, setPeriod] = useState<AppPeriod>("day")

    const filterByPeriod = useMemo(() => {
        const today = localDateStr()
        const weekAgo = localDateStr(new Date(Date.now() - 7 * 86400000))
        return {
            keys: (stats: AppStat[]) => {
                if (period === "day")
                    return stats.filter((s) => s.date === today)
                if (period === "week")
                    return stats.filter((s) => s.date >= weekAgo)
                return stats
            },
            clicks: (stats: AppClickStat[]) => {
                if (period === "day")
                    return stats.filter((s) => s.date === today)
                if (period === "week")
                    return stats.filter((s) => s.date >= weekAgo)
                return stats
            },
        }
    }, [period])

    const keyData = useMemo(
        () => computeAppTotals(filterByPeriod.keys(appStats)),
        [appStats, filterByPeriod],
    )

    const clickData = useMemo(() => {
        const map = new Map<string, { left: number; right: number }>()
        for (const { app, left_clicks, right_clicks } of filterByPeriod.clicks(
            clickStats,
        )) {
            const prev = map.get(app) ?? { left: 0, right: 0 }
            map.set(app, {
                left: prev.left + left_clicks,
                right: prev.right + right_clicks,
            })
        }
        return map
    }, [clickStats, filterByPeriod])

    const merged = useMemo(() => {
        const all = keyData.map(({ app, count }) => {
            const c = clickData.get(app) ?? { left: 0, right: 0 }
            return { app, keys: count, left: c.left, right: c.right }
        })
        for (const [app, { left, right }] of clickData) {
            if (!all.find((d) => d.app === app)) {
                all.push({ app, keys: 0, left, right })
            }
        }
        return all
            .sort(
                (a, b) =>
                    b.keys + b.left + b.right - (a.keys + a.left + a.right),
            )
            .slice(0, 10)
    }, [keyData, clickData])

    const max = Math.max(...merged.map((d) => d.keys + d.left + d.right), 1)

    const periods: { id: AppPeriod; label: string }[] = [
        { id: "day", label: "Today" },
        { id: "week", label: "Week" },
        { id: "all", label: "90d" },
    ]

    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
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
                <div className="flex items-center gap-2.5 text-[10px] text-zinc-400">
                    <span className="flex items-center gap-1">
                        <span className="inline-block w-2 h-2 rounded-sm bg-indigo-400" />
                        {t.chart.keysLabel}
                    </span>
                    <span className="flex items-center gap-1">
                        <span className="inline-block w-2 h-2 rounded-sm bg-rose-400" />
                        {t.chart.clicksLabel}
                    </span>
                </div>
            </div>

            {merged.length === 0 ? (
                <p className="text-xs text-zinc-400 text-center py-1">
                    {t.stats.noDataYet}
                </p>
            ) : (
                <div className="flex flex-col gap-2">
                    {merged.map(({ app, keys, left, right }) => (
                        <AppRow
                            key={app}
                            app={app}
                            keys={keys}
                            left={left}
                            right={right}
                            max={max}
                        />
                    ))}
                </div>
            )}
        </div>
    )
}

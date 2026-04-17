import { useMemo, useState } from "react"
import type { AppClickStat, AppStat, DayStat } from "@/api"
import { cn } from "@/lib/utils"
import { AppIcon, useAppDisplayName } from "./AppIcon"
import { computeAppTotals, last7Days, localDateStr } from "./helpers"
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
                            {keys.toLocaleString()} keys
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

export function DailyBarChart({
    stats,
    clickStats,
    selectedDate,
    onSelectDate,
}: {
    stats: DayStat[]
    clickStats: AppClickStat[]
    selectedDate: string | null
    onSelectDate: (date: string | null) => void
}) {
    const recent = useMemo(() => stats.slice(-30), [stats])
    const today = localDateStr()
    const displayDate = selectedDate ?? today

    // Daily click totals aggregated from per-app data
    const dailyClicks = useMemo(() => {
        const map = new Map<string, number>()
        for (const s of clickStats) {
            map.set(
                s.date,
                (map.get(s.date) ?? 0) + s.left_clicks + s.right_clicks,
            )
        }
        return map
    }, [clickStats])

    const max = useMemo(
        () =>
            Math.max(
                ...recent.map((s) => s.count + (dailyClicks.get(s.date) ?? 0)),
                1,
            ),
        [recent, dailyClicks],
    )

    const [hovered, setHovered] = useState<string | null>(null)
    const infoDate = hovered ?? displayDate
    const infoKeys = recent.find((s) => s.date === infoDate)?.count ?? 0
    const infoClicks = dailyClicks.get(infoDate) ?? 0

    return (
        <div className="flex flex-col gap-1.5">
            {/* Hover info line */}
            <div className="flex items-center gap-3 h-4 text-[10px]">
                <span className="text-zinc-400">{infoDate}</span>
                <span className="flex items-center gap-1 text-zinc-500">
                    <span className="inline-block w-1.5 h-1.5 rounded-sm bg-indigo-400" />
                    {infoKeys.toLocaleString()} keys
                </span>
                {infoClicks > 0 && (
                    <span className="flex items-center gap-1 text-zinc-500">
                        <span className="inline-block w-1.5 h-1.5 rounded-sm bg-rose-400" />
                        {infoClicks.toLocaleString()} clicks
                    </span>
                )}
            </div>

            {/* Bars */}
            <div className="flex items-end gap-0.5 h-20">
                {recent.map((s) => {
                    const clicks = dailyClicks.get(s.date) ?? 0
                    const total = s.count + clicks
                    const totalPct = (total / max) * 100
                    const keyFrac = total > 0 ? s.count / total : 1
                    const clickFrac = 1 - keyFrac
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
                            onMouseEnter={() => setHovered(s.date)}
                            onMouseLeave={() => setHovered(null)}
                        >
                            <div
                                className={cn(
                                    "w-full rounded-sm overflow-hidden flex flex-col-reverse transition-all duration-150",
                                    isSelected
                                        ? "opacity-100"
                                        : "opacity-60 group-hover:opacity-90",
                                )}
                                style={{
                                    height: `${totalPct}%`,
                                    minHeight: total ? 2 : 0,
                                }}
                            >
                                {/* Keys segment (bottom) */}
                                <div
                                    className={cn(
                                        "w-full shrink-0",
                                        isToday
                                            ? "bg-indigo-500"
                                            : isSelected
                                              ? "bg-zinc-500"
                                              : isWeekend
                                                ? "bg-zinc-300"
                                                : "bg-zinc-200",
                                    )}
                                    style={{ height: `${keyFrac * 100}%` }}
                                />
                                {/* Clicks segment (top) */}
                                {clicks > 0 && (
                                    <div
                                        className="w-full shrink-0 bg-rose-400"
                                        style={{
                                            height: `${clickFrac * 100}%`,
                                        }}
                                    />
                                )}
                            </div>
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

// ─── Last7DaysChart ───────────────────────────────────────────────────────────

export function Last7DaysChart({
    stats,
    clickStats,
}: {
    stats: DayStat[]
    clickStats: AppClickStat[]
}) {
    const days = useMemo(() => last7Days(), [])

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

    const rows = useMemo(
        () =>
            days.map(({ date, label, isToday }) => ({
                date,
                label,
                isToday,
                keys: keyMap.get(date) ?? 0,
                clicks: clickMap.get(date) ?? 0,
            })),
        [days, keyMap, clickMap],
    )

    const max = useMemo(
        () => Math.max(...rows.map((r) => r.keys + r.clicks), 1),
        [rows],
    )

    return (
        <div className="flex flex-col gap-2">
            {rows.map(({ date, label, isToday, keys, clicks }) => {
                const total = keys + clicks
                return (
                    <Tip
                        key={date}
                        content={
                            total > 0 ? (
                                <span className="flex gap-2.5">
                                    <span className="font-medium">{date}</span>
                                    {keys > 0 && (
                                        <span className="flex items-center gap-1">
                                            <span className="inline-block w-1.5 h-1.5 rounded-sm bg-indigo-400" />
                                            {keys.toLocaleString()} keys
                                        </span>
                                    )}
                                    {clicks > 0 && (
                                        <span className="flex items-center gap-1">
                                            <span className="inline-block w-1.5 h-1.5 rounded-sm bg-rose-400" />
                                            {clicks.toLocaleString()} clicks
                                        </span>
                                    )}
                                </span>
                            ) : (
                                <span>{date} · no data</span>
                            )
                        }
                    >
                        <div className="flex items-center gap-2.5">
                            <span
                                className={cn(
                                    "text-[11px] w-10 shrink-0",
                                    isToday
                                        ? "text-indigo-500 font-semibold"
                                        : "text-zinc-400",
                                )}
                            >
                                {label}
                            </span>
                            <div className="flex-1 h-2.5 bg-zinc-100 rounded-full overflow-hidden flex">
                                <div
                                    className={cn(
                                        "h-full transition-all duration-500",
                                        isToday
                                            ? "bg-indigo-500"
                                            : "bg-indigo-400",
                                    )}
                                    style={{ width: `${(keys / max) * 100}%` }}
                                />
                                <div
                                    className="h-full bg-rose-400 transition-all duration-500"
                                    style={{
                                        width: `${(clicks / max) * 100}%`,
                                    }}
                                />
                            </div>
                            <span className="text-[11px] text-zinc-400 w-14 text-right tabular-nums">
                                {total > 0 ? total.toLocaleString() : "—"}
                            </span>
                        </div>
                    </Tip>
                )
            })}
        </div>
    )
}

// ─── AppBreakdownChart ────────────────────────────────────────────────────────

type AppPeriod = "day" | "week" | "all"

export function AppBreakdownChart({
    appStats,
    clickStats,
}: {
    appStats: AppStat[]
    clickStats: AppClickStat[]
}) {
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

    // Aggregate left/right clicks per app across filtered dates
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

    // Merge: all apps that appear in either dataset
    const merged = useMemo(() => {
        const all = keyData.map(({ app, count }) => {
            const c = clickData.get(app) ?? { left: 0, right: 0 }
            return { app, keys: count, left: c.left, right: c.right }
        })
        // Apps with only clicks (no keystrokes)
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
            {/* Period selector + legend */}
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
                        Keys
                    </span>
                    <span className="flex items-center gap-1">
                        <span className="inline-block w-2 h-2 rounded-sm bg-rose-400" />
                        Clicks
                    </span>
                </div>
            </div>

            {merged.length === 0 ? (
                <p className="text-xs text-zinc-400 text-center py-1">
                    No data yet — start typing!
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

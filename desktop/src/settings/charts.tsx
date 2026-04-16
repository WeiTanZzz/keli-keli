import { useEffect, useMemo, useRef, useState } from "react"
import { type AppClickStat, type AppStat, type DayStat, api } from "@/api"
import { cn } from "@/lib/utils"
import { localDateStr, last7Days, computeAppTotals } from "./helpers"

// ─── Display name resolution ──────────────────────────────────────────────────

// Module-level cache so repeated renders don't re-fetch the same name.
const displayNameCache = new Map<string, string | null>()

/** Derive a reasonable fallback from a bundle id without an OS lookup. */
function bundleFallback(id: string): string {
    const parts = id.split(".")
    if (parts.length > 1) {
        const last = parts[parts.length - 1]
        return last.charAt(0).toUpperCase() + last.slice(1)
    }
    return id
}

/** Returns the OS-resolved display name for a bundle id, falling back to
 *  the last dot-segment while the async lookup is in flight. */
export function useAppDisplayName(id: string): string {
    const cached = displayNameCache.get(id)
    const [name, setName] = useState<string>(cached ?? bundleFallback(id))

    useEffect(() => {
        if (displayNameCache.has(id)) return
        api.getAppDisplayName(id).then((n) => {
            const resolved = n ?? null
            displayNameCache.set(id, resolved)
            if (resolved) setName(resolved)
        })
    }, [id])

    return name
}

// ─── Tooltip ──────────────────────────────────────────────────────────────────

export function Tip({
    children,
    content,
}: {
    children: React.ReactNode
    content: React.ReactNode
}) {
    const ref = useRef<HTMLDivElement>(null)
    const [rect, setRect] = useState<DOMRect | null>(null)

    return (
        <div
            ref={ref}
            onMouseEnter={() =>
                setRect(ref.current?.getBoundingClientRect() ?? null)
            }
            onMouseLeave={() => setRect(null)}
        >
            {children}
            {rect && (
                <div
                    className="fixed z-[9999] -translate-x-1/2 bg-zinc-800/95 text-white text-[10px] rounded-md px-2 py-1 whitespace-nowrap pointer-events-none shadow-lg"
                    style={{
                        left: rect.left + rect.width / 2,
                        top: rect.top - 6,
                        transform: "translate(-50%, -100%)",
                    }}
                >
                    {content}
                </div>
            )}
        </div>
    )
}

// ─── App icon ─────────────────────────────────────────────────────────────────

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

export function AppIcon({ app }: { app: string }) {
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

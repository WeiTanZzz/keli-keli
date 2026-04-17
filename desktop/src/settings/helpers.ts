import type { AppStat, DayStat } from "@/api"

/**
 * Returns a YYYY-MM-DD string in the *local* timezone.
 * Using toISOString() would give the UTC date, which can differ from the local
 * date by one day around midnight for users outside UTC. Rust stores dates
 * with chrono::Local, so the frontend must match.
 */
export function localDateStr(d: Date = new Date()): string {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, "0")
    const day = String(d.getDate()).padStart(2, "0")
    return `${y}-${m}-${day}`
}

export const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

export function last7Days(): {
    date: string
    label: string
    isToday: boolean
}[] {
    return Array.from({ length: 7 }, (_, i) => {
        const d = new Date()
        d.setDate(d.getDate() - i)
        const date = localDateStr(d)
        return {
            date,
            label: i === 0 ? "Today" : DOW[d.getDay()],
            isToday: i === 0,
        }
    })
}

export function computeAppTotals(
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

export function computeStreak(stats: DayStat[]): number {
    const dateMap = new Map(stats.map((s) => [s.date, s.count]))
    let streak = 0
    const d = new Date()
    while (true) {
        const key = localDateStr(d)
        if ((dateMap.get(key) ?? 0) > 0) {
            streak++
            d.setDate(d.getDate() - 1)
        } else {
            break
        }
    }
    return streak
}

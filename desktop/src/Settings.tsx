import { listen } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { BarChart2, Cable, Info, Keyboard, Settings2 } from "lucide-react"
import { useEffect, useState } from "react"
import {
    type AllTimeCounts,
    type AppClickStat,
    type AppStat,
    api,
    type Config,
    type DayStat,
} from "@/api"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import { useT } from "./i18n"
import { localDateStr } from "./settings/helpers"
import {
    AboutSection,
    ConnectionsSection,
    GeneralSection,
    IndicatorSection,
    StatisticsSection,
    type UpdateState,
} from "./settings/sections"

// ─── Nav config ───────────────────────────────────────────────────────────────

type NavId = "statistics" | "general" | "indicator" | "connections" | "about"

const NAV_ITEMS: { id: NavId; icon: React.ElementType }[] = [
    { id: "statistics", icon: BarChart2 },
    { id: "general", icon: Settings2 },
    { id: "indicator", icon: Keyboard },
    { id: "connections", icon: Cable },
    { id: "about", icon: Info },
]

// ─── TitleBar ─────────────────────────────────────────────────────────────────

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
    const { t } = useT()
    const [cfg, setCfg] = useState<Config | null>(null)
    const [autostart, setAutostart] = useState(false)
    const [stats, setStats] = useState<DayStat[]>([])
    const [appStats, setAppStats] = useState<AppStat[]>([])
    const [clickStats, setClickStats] = useState<AppClickStat[]>([])
    const [allTimeCounts, setAllTimeCounts] = useState<AllTimeCounts | null>(
        null,
    )
    const [saved, setSaved] = useState(false)
    const [showRestartDialog, setShowRestartDialog] = useState(false)
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
            .catch(() => setUpdate({ status: "error" }))

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
        if (active === "connections") {
            setShowRestartDialog(true)
            return
        }
        await api.saveConfig(cfg)
        setSaved(true)
        setTimeout(() => setSaved(false), 1500)
    }

    const handleSaveAndRestart = async () => {
        if (!cfg) return
        setShowRestartDialog(false)
        await api.saveConfigAndRestart(cfg)
    }

    const setSync = (patch: Partial<Config["sync"]>) =>
        setCfg((c) => (c ? { ...c, sync: { ...c.sync, ...patch } } : c))
    const setWs = (patch: Partial<Config["websocket"]>) =>
        setCfg((c) =>
            c ? { ...c, websocket: { ...c.websocket, ...patch } } : c,
        )
    const setIndicator = (patch: Partial<Config["indicator"]>) =>
        setCfg((c) =>
            c ? { ...c, indicator: { ...c.indicator, ...patch } } : c,
        )

    if (!cfg) return null

    const showSave =
        active === "general" ||
        active === "indicator" ||
        active === "connections"

    return (
        <div className="flex flex-col h-screen bg-zinc-100 font-sans select-none overflow-hidden rounded-xl">
            <TitleBar />

            <div className="flex flex-1 min-h-0">
                {/* Sidebar */}
                <aside className="w-44 flex flex-col border-r border-zinc-200 bg-zinc-50/80 shrink-0">
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
                                    <span className="flex-1">
                                        {t.nav[item.id]}
                                    </span>
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
                        {active === "indicator" && cfg && (
                            <IndicatorSection
                                cfg={cfg}
                                onIndicator={setIndicator}
                            />
                        )}
                        {active === "connections" && cfg && (
                            <ConnectionsSection
                                cfg={cfg}
                                stats={stats}
                                appStats={appStats}
                                clickStats={clickStats}
                                onUpdateSync={setSync}
                                onUpdateWs={setWs}
                            />
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
                            <div className="p-4">
                                <Button
                                    size="full"
                                    variant={saved ? "success" : "default"}
                                    onClick={handleSave}
                                >
                                    {saved ? t.btn.saved : t.btn.save}
                                </Button>
                            </div>
                        </>
                    )}
                </main>
            </div>

            {showRestartDialog && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
                    <div className="bg-white rounded-xl shadow-xl w-72 p-5 flex flex-col gap-4">
                        <div className="flex flex-col gap-1">
                            <span className="text-sm font-semibold text-zinc-800">
                                {t.dialog.restartRequired}
                            </span>
                            <span className="text-xs text-zinc-500 leading-relaxed">
                                {t.dialog.restartDesc}
                            </span>
                        </div>
                        <div className="flex gap-2">
                            <Button
                                size="sm"
                                variant="outline"
                                className="flex-1"
                                onClick={() => setShowRestartDialog(false)}
                            >
                                {t.btn.cancel}
                            </Button>
                            <Button
                                size="sm"
                                className="flex-1"
                                onClick={handleSaveAndRestart}
                            >
                                {t.btn.saveAndReopen}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

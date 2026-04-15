import { listen } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { useEffect, useState } from "react"
import { api } from "@/api"

export default function Dashboard() {
    const [count, setCount] = useState(0)
    const [indicatorVisible, setIndicatorVisible] = useState(true)

    useEffect(() => {
        api.getStats(1)
            .then((stats) => {
                if (stats.length > 0) setCount(stats[0].count)
            })
            .catch(() => {})

        api.getIndicatorVisible()
            .then(setIndicatorVisible)
            .catch(() => {})

        const unlisten = listen<{ count: number }>("keystroke", (e) => {
            setCount(e.payload.count)
        })

        return () => {
            unlisten.then((f) => f()).catch(() => {})
        }
    }, [])

    async function handleToggleIndicator() {
        await api.toggleIndicator()
        setIndicatorVisible((v) => !v)
    }

    async function handleOpenSettings() {
        getCurrentWindow().hide()
        await api.openSettings()
    }

    async function handleQuit() {
        await api.quitApp()
    }

    return (
        <div className="w-full h-full p-1.5 select-none">
            <div className="dashboard-card h-full rounded-2xl overflow-hidden flex flex-col">
                {/* Header */}
                <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-white/10">
                    <span className="text-sm">⌨️</span>
                    <span className="text-sm font-semibold text-white/90 tracking-tight">
                        KeliKeli
                    </span>
                </div>

                {/* Count */}
                <div className="flex flex-col items-center justify-center flex-1 py-3">
                    <span className="text-[40px] font-bold text-white leading-none tabular-nums">
                        {count.toLocaleString()}
                    </span>
                    <span className="text-xs text-white/50 mt-1.5 tracking-wide">
                        keystrokes today
                    </span>
                </div>

                {/* Actions */}
                <div className="px-2.5 pb-2.5 flex flex-col gap-1">
                    <button
                        type="button"
                        onClick={handleToggleIndicator}
                        className="dashboard-btn"
                    >
                        <span className="text-white/50 text-xs mr-1">⌨️</span>
                        {indicatorVisible ? "Hide Indicator" : "Show Indicator"}
                    </button>
                    <button
                        type="button"
                        onClick={handleOpenSettings}
                        className="dashboard-btn"
                    >
                        <span className="text-white/50 text-xs mr-1">⚙️</span>
                        Settings…
                    </button>
                    <div className="h-px bg-white/10 my-0.5" />
                    <button
                        type="button"
                        onClick={handleQuit}
                        className="dashboard-btn !text-red-300 hover:!bg-red-500/20"
                    >
                        Quit KeliKeli
                    </button>
                </div>
            </div>
        </div>
    )
}

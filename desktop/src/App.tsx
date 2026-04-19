import { listen } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { useEffect, useRef, useState } from "react"
import { api, type Config } from "@/api"

type PlusOneItem = { id: number; type: "key" | "left" | "right" | "middle" }

const DEFAULT_INDICATOR: Config["indicator"] = {
    icon_type: "emoji",
    icon_value: "⌨️",
    badge_keystroke: "+1",
    badge_left_click: "+1",
    badge_right_click: "+1",
}

// Module-level icon cache keyed by app bundle id
const appIconCache = new Map<string, string | null>()

export default function App() {
    const [plusOnes, setPlusOnes] = useState<PlusOneItem[]>([])
    const idRef = useRef(0)
    const [indicator, setIndicator] = useState(DEFAULT_INDICATOR)
    const [currentApp, setCurrentApp] = useState<string>("")
    const [activeAppIcon, setActiveAppIcon] = useState<string | null>(null)

    useEffect(() => {
        api.getConfig().then((cfg) => setIndicator(cfg.indicator))
    }, [])

    useEffect(() => {
        const unlisten = listen<Config>("config_changed", (e) => {
            setIndicator(e.payload.indicator)
        })
        return () => { unlisten.then((f) => f()).catch(() => {}) }
    }, [])

    // Resolve active app icon whenever currentApp changes
    useEffect(() => {
        if (indicator.icon_type !== "active_app" || !currentApp) return
        if (appIconCache.has(currentApp)) {
            const cached = appIconCache.get(currentApp)!
            setActiveAppIcon(cached ? `data:image/png;base64,${cached}` : null)
            return
        }
        api.getAppIcon(currentApp).then((b64) => {
            appIconCache.set(currentApp, b64)
            setActiveAppIcon(b64 ? `data:image/png;base64,${b64}` : null)
        })
    }, [currentApp, indicator.icon_type])

    useEffect(() => {
        const handleBlur = () => setPlusOnes([])
        window.addEventListener("blur", handleBlur)
        return () => window.removeEventListener("blur", handleBlur)
    }, [])

    useEffect(() => {
        const unlisten = listen<{ count: number; app: string }>("keystroke", (e) => {
            if (e.payload.app) setCurrentApp(e.payload.app)
            const id = ++idRef.current
            setPlusOnes((prev) => [...prev, { id, type: "key" }])
            setTimeout(() => {
                setPlusOnes((prev) => prev.filter((p) => p.id !== id))
            }, 750)
        })

        const unlistenClick = listen<{ app: string; button: number }>(
            "click",
            (e) => {
                if (e.payload.app) setCurrentApp(e.payload.app)
                const id = ++idRef.current
                const button = e.payload.button
                const type =
                    button === 0 ? "left" : button === 1 ? "right" : "middle"
                setPlusOnes((prev) => [...prev, { id, type }])
                setTimeout(() => {
                    setPlusOnes((prev) => prev.filter((p) => p.id !== id))
                }, 750)
            },
        )

        return () => {
            unlisten.then((f) => f()).catch(() => {})
            unlistenClick.then((f) => f()).catch(() => {})
        }
    }, [])

    const renderIcon = () => {
        if (indicator.icon_type === "active_app") {
            if (activeAppIcon) {
                return (
                    <img
                        src={activeAppIcon}
                        alt=""
                        style={{
                            width: 32,
                            height: 32,
                            pointerEvents: "none",
                            objectFit: "contain",
                            filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.4))",
                        }}
                    />
                )
            }
            // Fallback: letter avatar while loading or no icon available
            const letter = currentApp ? currentApp.split(".").pop()?.charAt(0).toUpperCase() ?? "?" : "?"
            return (
                <div
                    style={{
                        width: 32,
                        height: 32,
                        borderRadius: 8,
                        background: "rgba(100,100,100,0.6)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#fff",
                        fontSize: 14,
                        fontWeight: 700,
                        pointerEvents: "none",
                        filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.4))",
                    }}
                >
                    {letter}
                </div>
            )
        }

        return (
            <span
                style={{
                    fontSize: 32,
                    lineHeight: 1,
                    pointerEvents: "none",
                    filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.4))",
                }}
            >
                {indicator.icon_value || "⌨️"}
            </span>
        )
    }

    return (
        <div
            style={{
                width: "100vw",
                height: "100vh",
                position: "relative",
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "center",
                paddingBottom: 6,
            }}
            onMouseDown={(e) => {
                if (e.button === 0) {
                    e.preventDefault()
                    setPlusOnes([])
                    getCurrentWindow().startDragging()
                }
            }}
        >
            {renderIcon()}

            {plusOnes.map((p) => {
                const badgeText =
                    p.type === "key"
                        ? indicator.badge_keystroke || "+1"
                        : p.type === "left"
                          ? indicator.badge_left_click || "+1"
                          : indicator.badge_right_click || "+1"
                return (
                    <span
                        key={p.id}
                        className={`plus-one ${p.type !== "key" ? "plus-one-click" : ""}`}
                    >
                        {badgeText}
                    </span>
                )
            })}
        </div>
    )
}

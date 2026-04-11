import { listen } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { useEffect, useRef, useState } from "react"

export default function App() {
    const [plusOnes, setPlusOnes] = useState<{ id: number }[]>([])
    const idRef = useRef(0)

    useEffect(() => {
        const unlisten = listen<{ count: number }>("keystroke", () => {
            const id = ++idRef.current
            setPlusOnes((prev) => [...prev, { id }])
            setTimeout(() => {
                setPlusOnes((prev) => prev.filter((p) => p.id !== id))
            }, 750)
        })
        return () => {
            unlisten.then((f) => f())
        }
    }, [])

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
                if (e.button === 0) getCurrentWindow().startDragging()
            }}
        >
            <span
                style={{
                    fontSize: 32,
                    lineHeight: 1,
                    pointerEvents: "none",
                    filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.4))",
                }}
            >
                ⌨️
            </span>

            {plusOnes.map((p) => (
                <span key={p.id} className="plus-one">
                    +1
                </span>
            ))}
        </div>
    )
}

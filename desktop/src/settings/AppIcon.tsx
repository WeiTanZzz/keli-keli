import { useEffect, useState } from "react"
import { api } from "@/api"
import { cn } from "@/lib/utils"

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

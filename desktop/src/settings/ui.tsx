import { useRef, useState } from "react"
import { cn } from "@/lib/utils"

// ─── StatChip ─────────────────────────────────────────────────────────────────

export function StatChip({
    label,
    value,
    sub,
}: {
    label: string
    value: string
    sub?: string
}) {
    return (
        <div className="flex flex-col gap-1 px-3 py-3">
            <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-widest leading-none mb-1">
                {label}
            </span>
            <span className="text-xl font-bold text-zinc-800 tabular-nums leading-none">
                {value}
            </span>
            <span className="text-[10px] text-zinc-400 leading-none mt-0.5">
                {sub ?? ""}
            </span>
        </div>
    )
}

// ─── FormRow ──────────────────────────────────────────────────────────────────

export function FormRow({
    label,
    description,
    children,
}: {
    label: string
    description?: string
    children: React.ReactNode
}) {
    return (
        <div className="flex items-center justify-between gap-4 py-3 px-4">
            <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-sm text-zinc-800">{label}</span>
                {description && (
                    <span className="text-xs text-zinc-400">{description}</span>
                )}
            </div>
            {children}
        </div>
    )
}

// ─── Card ─────────────────────────────────────────────────────────────────────

export function Card({ children }: { children: React.ReactNode }) {
    return (
        <div className="bg-white rounded-xl border border-zinc-200 divide-y divide-zinc-100 overflow-hidden">
            {children}
        </div>
    )
}

// ─── SectionTitle ─────────────────────────────────────────────────────────────

export function SectionTitle({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex items-center gap-2 mb-1">
            <span className="w-1 h-3.5 rounded-full bg-indigo-400 shrink-0" />
            <h2 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-widest">
                {children}
            </h2>
        </div>
    )
}

// ─── Tip ──────────────────────────────────────────────────────────────────────

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

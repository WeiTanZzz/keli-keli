import type { DateRange } from "react-day-picker"
import { DayPicker } from "react-day-picker"
import { cn } from "@/lib/utils"

export type { DateRange }

export function Calendar({
    className,
    classNames,
    showOutsideDays = true,
    ...props
}: React.ComponentProps<typeof DayPicker>) {
    return (
        <DayPicker
            showOutsideDays={showOutsideDays}
            className={cn("p-3 select-none", className)}
            style={
                {
                    "--rdp-accent-color": "rgb(99 102 241)",
                    "--rdp-accent-background-color": "rgb(224 231 255)",
                    "--rdp-day-height": "2rem",
                    "--rdp-day-width": "2rem",
                    "--rdp-day_button-height": "1.75rem",
                    "--rdp-day_button-width": "1.75rem",
                    "--rdp-day_button-border-radius": "9999px",
                    "--rdp-day_button-border": "none",
                    "--rdp-selected-border": "none",
                    "--rdp-today-color": "rgb(99 102 241)",
                } as React.CSSProperties
            }
            classNames={{
                months: "flex flex-col gap-4",
                month: "flex flex-col gap-4",
                month_caption:
                    "flex justify-center items-center h-7 relative",
                caption_label: "text-sm font-medium text-zinc-800",
                nav: "absolute inset-x-0 top-0 flex justify-between items-center h-7 px-1",
                button_previous:
                    "w-7 h-7 flex items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 transition-colors",
                button_next:
                    "w-7 h-7 flex items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 transition-colors",
                weeks: "flex flex-col gap-0.5",
                weekdays: "flex",
                weekday:
                    "w-8 text-center text-[10px] font-medium text-zinc-400 pb-1",
                week: "flex",
                day: "text-center",
                day_button:
                    "text-[12px] font-medium text-zinc-700 hover:bg-indigo-50 hover:text-indigo-600 transition-colors focus:outline-none",
                selected: "font-semibold",
                today: "font-bold",
                outside: "opacity-30",
                disabled: "opacity-20 pointer-events-none",
                hidden: "invisible",
                ...classNames,
            }}
            {...props}
        />
    )
}

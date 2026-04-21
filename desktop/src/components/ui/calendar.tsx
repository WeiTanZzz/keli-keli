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
            classNames={{
                months: "flex flex-col gap-4",
                month: "flex flex-col gap-4",
                month_caption: "flex justify-center items-center h-7 relative",
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
                // day is the cell container; button sits centered inside
                day: "relative w-8 h-8 p-0 flex items-center justify-center",
                day_button: cn(
                    "relative z-10 w-6 h-6 rounded-full text-[12px] font-medium transition-colors",
                    "text-zinc-700 hover:bg-indigo-50 hover:text-indigo-600",
                    "focus:outline-none focus:ring-2 focus:ring-indigo-400",
                ),
                selected:
                    "[&>button]:bg-indigo-500 [&>button]:text-white [&>button]:hover:bg-indigo-600 [&>button]:hover:text-white",
                today: "[&>button]:font-bold [&>button]:text-indigo-600",
                outside:
                    "[&>button]:text-zinc-300 [&>button]:hover:bg-transparent [&>button]:hover:text-zinc-300",
                disabled:
                    "[&>button]:text-zinc-200 [&>button]:pointer-events-none",
                // before: covers the half-cell behind the circle to connect to the middle strip
                range_start:
                    "before:content-[''] before:absolute before:inset-y-0 before:left-1/2 before:right-0 before:bg-indigo-100 [&>button]:bg-indigo-500 [&>button]:text-white [&>button]:hover:bg-indigo-600",
                range_end:
                    "before:content-[''] before:absolute before:inset-y-0 before:left-0 before:right-1/2 before:bg-indigo-100 [&>button]:bg-indigo-500 [&>button]:text-white [&>button]:hover:bg-indigo-600",
                // Full-width strip; button is transparent so strip color shows through
                range_middle:
                    "bg-indigo-100 [&>button]:w-full [&>button]:h-full [&>button]:rounded-none [&>button]:bg-transparent [&>button]:text-indigo-700 [&>button]:hover:bg-indigo-200",
                hidden: "invisible",
                ...classNames,
            }}
            {...props}
        />
    )
}

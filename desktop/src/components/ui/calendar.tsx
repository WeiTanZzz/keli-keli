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
                day: "w-8 h-8 p-0 text-center",
                day_button: cn(
                    "w-full h-full rounded-md text-[12px] font-medium transition-colors",
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
                range_start:
                    "[&>button]:bg-indigo-500 [&>button]:text-white [&>button]:rounded-md",
                range_end:
                    "[&>button]:bg-indigo-500 [&>button]:text-white [&>button]:rounded-md",
                range_middle:
                    "[&>button]:bg-indigo-100 [&>button]:text-indigo-700 [&>button]:rounded-none [&>button]:hover:bg-indigo-200",
                hidden: "invisible",
                ...classNames,
            }}
            {...props}
        />
    )
}

import { cn } from "@/lib/utils"
import * as React from "react"

export interface InputProps
    extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
    ({ className, type, ...props }, ref) => {
        return (
            <input
                type={type}
                className={cn(
                    "flex h-8 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-sm text-zinc-800 placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:border-transparent disabled:cursor-not-allowed disabled:opacity-50",
                    type === "number" ? "w-20" : "w-44",
                    className,
                )}
                ref={ref}
                {...props}
            />
        )
    },
)
Input.displayName = "Input"

export { Input }

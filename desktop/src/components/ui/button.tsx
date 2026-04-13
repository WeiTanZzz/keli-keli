import { cn } from "@/lib/utils"
import { cva, type VariantProps } from "class-variance-authority"
import * as React from "react"

const buttonVariants = cva(
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:pointer-events-none disabled:opacity-50",
    {
        variants: {
            variant: {
                default:
                    "bg-indigo-500 text-white hover:bg-indigo-600 active:bg-indigo-700",
                outline:
                    "border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50",
                ghost: "text-zinc-700 hover:bg-zinc-100",
                success: "bg-emerald-500 text-white",
            },
            size: {
                default: "h-9 px-4 py-2",
                sm: "h-7 px-3 text-xs",
                lg: "h-10 px-6",
                full: "h-9 w-full px-4 py-2",
            },
        },
        defaultVariants: {
            variant: "default",
            size: "default",
        },
    },
)

export interface ButtonProps
    extends React.ButtonHTMLAttributes<HTMLButtonElement>,
        VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    ({ className, variant, size, ...props }, ref) => {
        return (
            <button
                className={cn(buttonVariants({ variant, size, className }))}
                ref={ref}
                {...props}
            />
        )
    },
)
Button.displayName = "Button"

export { Button, buttonVariants }

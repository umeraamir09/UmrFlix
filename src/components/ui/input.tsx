import { cn } from "@/lib/utils"
import { forwardRef } from "react"

type InputProps = React.InputHTMLAttributes<HTMLInputElement>

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          "flex h-11 w-full rounded-[4px] border border-[#414141] bg-[#333333] px-3.5 py-2.5 text-sm text-white placeholder:text-[#808080] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E50914] focus-visible:border-transparent transition-all disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"


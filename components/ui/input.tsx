import type { ComponentProps } from "react"
import { cn } from "@/lib/utils"

/**
 * Text input for the calm skin: 48px tall, 16px text (no iOS zoom), a border
 * with at least 3:1 contrast, and a visible focus ring.
 */
function Input({ className, type, ...props }: ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-12 w-full min-w-0 rounded-lg border border-subtle bg-surface px-3 text-base text-ink outline-none transition-colors placeholder:text-subtle focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  )
}

export { Input }

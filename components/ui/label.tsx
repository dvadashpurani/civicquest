import type { ComponentProps } from "react"
import { cn } from "@/lib/utils"

/** Form label. Always pair with `htmlFor` pointing at the control's `id`. */
function Label({ className, ...props }: ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn("block text-base font-bold text-ink", className)}
      {...props}
    />
  )
}

export { Label }

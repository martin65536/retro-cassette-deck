import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

// 复古暖棕配色：胶木质感按钮，与磁带机身统一
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-orange-400/50",
  {
    variants: {
      variant: {
        // 默认：橙红胶木
        default:
          "bg-gradient-to-b from-orange-500 to-orange-700 text-amber-50 shadow-md hover:from-orange-400 hover:to-orange-600 active:translate-y-[1px]",
        destructive:
          "bg-gradient-to-b from-red-600 to-red-800 text-red-50 shadow-md hover:from-red-500 hover:to-red-700 active:translate-y-[1px]",
        // outline：奶油底棕褐边
        outline:
          "border border-amber-800/50 bg-amber-50/90 text-amber-900 shadow-sm hover:bg-amber-100 hover:border-amber-700",
        // secondary：暖棕底
        secondary:
          "bg-gradient-to-b from-amber-800 to-amber-950 text-amber-100 shadow-md hover:from-amber-700 hover:to-amber-900 active:translate-y-[1px]",
        // ghost：透明暖色悬停
        ghost:
          "text-amber-100 hover:bg-amber-800/40 hover:text-amber-50",
        link: "text-orange-400 underline-offset-4 hover:underline hover:text-orange-300",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }

/** Button —— React 类组件 · 复古暖色胶木风格 */
class Button extends React.Component<ButtonProps> {
  render() {
    const {
      className,
      variant,
      size,
      asChild = false,
      ...props
    } = this.props
    const Comp = asChild ? (Slot as React.ElementType) : "button"
    return (
      <Comp
        data-slot="button"
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      />
    )
  }
}

export { Button, buttonVariants }

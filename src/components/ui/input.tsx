import * as React from "react"

import { cn } from "@/lib/utils"

type InputProps = React.ComponentProps<"input">

/** Input —— React 类组件 · 复古奶油底棕褐边 */
class Input extends React.Component<InputProps> {
  render() {
    const { className, type, ...props } = this.props
    return (
      <input
        type={type}
        data-slot="input"
        className={cn(
          "flex h-9 w-full min-w-0 rounded-md border border-amber-800/50 bg-amber-50/90 px-3 py-1 text-base text-amber-900 shadow-sm outline-none transition-[color,box-shadow]",
          "placeholder:text-amber-700/50",
          "focus-visible:border-orange-600 focus-visible:ring-2 focus-visible:ring-orange-400/40",
          "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className
        )}
        {...props}
      />
    )
  }
}

export { Input }

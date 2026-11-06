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
          "flex h-9 w-full min-w-0 rounded-none border border-black bg-stone-900 px-3 py-1 text-base text-stone-100 outline-none transition-[color,box-shadow]",
          "placeholder:text-stone-600",
          "focus-visible:border-amber-500 focus-visible:ring-1 focus-visible:ring-amber-500",
          "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className
        )}
        {...props}
      />
    )
  }
}

export { Input }

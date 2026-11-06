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
          "flex h-9 w-full min-w-0 rounded-none border border-black bg-white px-3 py-1 text-base text-black shadow-sm outline-none transition-[color,box-shadow]",
          "placeholder:text-gray-400",
          "focus-visible:border-black focus-visible:ring-1 focus-visible:ring-black",
          "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className
        )}
        {...props}
      />
    )
  }
}

export { Input }

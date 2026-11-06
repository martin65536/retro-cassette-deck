"use client"

import * as React from "react"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"

import { cn } from "@/lib/utils"

type TooltipProviderProps = React.ComponentProps<typeof TooltipPrimitive.Provider>
type TooltipProps = React.ComponentProps<typeof TooltipPrimitive.Root>
type TooltipTriggerProps = React.ComponentProps<typeof TooltipPrimitive.Trigger>
type TooltipContentProps = React.ComponentProps<typeof TooltipPrimitive.Content>

/** Tooltip —— React 类组件 · 复古暖色气泡 */
class TooltipProvider extends React.Component<TooltipProviderProps> {
  render() {
    const { delayDuration = 200, ...props } = this.props
    return (
      <TooltipPrimitive.Provider
        data-slot="tooltip-provider"
        delayDuration={delayDuration}
        {...props}
      />
    )
  }
}

class Tooltip extends React.Component<TooltipProps> {
  render() {
    const { ...props } = this.props
    return (
      <TooltipProvider>
        <TooltipPrimitive.Root data-slot="tooltip" {...props} />
      </TooltipProvider>
    )
  }
}

class TooltipTrigger extends React.Component<TooltipTriggerProps> {
  render() {
    const { ...props } = this.props
    return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
  }
}

class TooltipContent extends React.Component<TooltipContentProps> {
  render() {
    const { className, sideOffset = 4, children, ...props } = this.props
    return (
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          data-slot="tooltip-content"
          sideOffset={sideOffset}
          className={cn(
            "z-50 w-fit origin-(--radix-tooltip-content-transform-origin) rounded-none px-3 py-1.5 text-xs text-balance",
            "bg-black text-white",
            "border border-black",
            "animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
            "data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
            className
          )}
          {...props}
        >
          {children}
          <TooltipPrimitive.Arrow className="fill-black z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px]" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    )
  }
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }

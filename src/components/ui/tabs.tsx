"use client"

import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"

import { cn } from "@/lib/utils"

type TabsProps = React.ComponentProps<typeof TabsPrimitive.Root>
type TabsListProps = React.ComponentProps<typeof TabsPrimitive.List>
type TabsTriggerProps = React.ComponentProps<typeof TabsPrimitive.Trigger>
type TabsContentProps = React.ComponentProps<typeof TabsPrimitive.Content>

/** Tabs —— React 类组件 · 复古暖色面板 */
class Tabs extends React.Component<TabsProps> {
  render() {
    const { className, ...props } = this.props
    return (
      <TabsPrimitive.Root
        data-slot="tabs"
        className={cn("flex flex-col gap-2", className)}
        {...props}
      />
    )
  }
}

class TabsList extends React.Component<TabsListProps> {
  render() {
    const { className, ...props } = this.props
    return (
      <TabsPrimitive.List
        data-slot="tabs-list"
        className={cn(
          "inline-flex h-9 w-full items-center justify-center rounded-lg p-[3px]",
          "bg-gradient-to-b from-stone-800 to-stone-900",
          "shadow-inner border border-stone-700/60",
          className
        )}
        {...props}
      />
    )
  }
}

class TabsTrigger extends React.Component<TabsTriggerProps> {
  render() {
    const { className, ...props } = this.props
    return (
      <TabsPrimitive.Trigger
        data-slot="tabs-trigger"
        className={cn(
          "inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium whitespace-nowrap transition-all",
          "text-stone-400",
          "hover:text-amber-200 hover:bg-stone-800",
          "data-[state=active]:bg-gradient-to-b data-[state=active]:from-stone-700 data-[state=active]:to-stone-800",
          "data-[state=active]:text-amber-300 data-[state=active]:shadow-sm",
          "data-[state=active]:border data-[state=active]:border-orange-700/40",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/40",
          "disabled:pointer-events-none disabled:opacity-50",
          "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
          className
        )}
        {...props}
      />
    )
  }
}

class TabsContent extends React.Component<TabsContentProps> {
  render() {
    const { className, ...props } = this.props
    return (
      <TabsPrimitive.Content
        data-slot="tabs-content"
        className={cn("flex-1 outline-none", className)}
        {...props}
      />
    )
  }
}

export { Tabs, TabsList, TabsTrigger, TabsContent }

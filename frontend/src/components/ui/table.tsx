import * as React from "react"

import { cn } from "@/lib/utils"

const SCROLL_SHADOW_LEFT = "inset 10px 0 8px -8px rgba(0,0,0,0.22)"
const SCROLL_SHADOW_RIGHT = "inset -10px 0 8px -8px rgba(0,0,0,0.22)"
// レイアウトの端数誤差など、実質スクロール不要な程度のはみ出しでは出さない
const SCROLL_SHADOW_THRESHOLD = 16

function Table({ className, ...props }: React.ComponentProps<"table">) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const [scrollShadow, setScrollShadow] = React.useState({ left: false, right: false })

  const updateScrollShadow = React.useCallback(() => {
    const el = containerRef.current
    if (!el) return
    setScrollShadow({
      left: el.scrollLeft > SCROLL_SHADOW_THRESHOLD,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - SCROLL_SHADOW_THRESHOLD,
    })
  }, [])

  React.useEffect(() => {
    const el = containerRef.current
    if (!el) return
    updateScrollShadow()
    el.addEventListener("scroll", updateScrollShadow, { passive: true })
    const resizeObserver = new ResizeObserver(updateScrollShadow)
    resizeObserver.observe(el)
    const table = el.querySelector("table")
    if (table) resizeObserver.observe(table)
    return () => {
      el.removeEventListener("scroll", updateScrollShadow)
      resizeObserver.disconnect()
    }
  }, [updateScrollShadow])

  const boxShadow = [
    scrollShadow.left && SCROLL_SHADOW_LEFT,
    scrollShadow.right && SCROLL_SHADOW_RIGHT,
  ]
    .filter(Boolean)
    .join(", ")

  return (
    <div
      ref={containerRef}
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
      style={boxShadow ? { boxShadow } : undefined}
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("bg-muted [&_tr]:border-b", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors in-data-[slot=table-body]:hover:bg-muted/50 in-data-[slot=table-body]:has-aria-expanded:bg-muted/50 in-data-[slot=table-body]:data-[state=selected]:bg-muted",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 px-4 text-left align-middle font-medium whitespace-nowrap text-foreground first:pl-6 last:pr-6 [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "px-4 py-2 align-middle whitespace-nowrap first:pl-6 last:pr-6 [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}

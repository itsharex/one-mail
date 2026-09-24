import * as React from 'react'
import { X } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from '@renderer/components/ui/popover'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { useI18n } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'

export type StatusSeverity = 'normal' | 'warning' | 'danger'

export function StatusDot({ severity }: { severity: StatusSeverity }): React.JSX.Element {
  const color = severity === 'danger' ? 'bg-destructive' : severity === 'warning' ? 'bg-warning' : 'bg-emerald-500 dark:bg-emerald-400'
  return <span className={cn('size-1.5 shrink-0 rounded-full', color)} aria-hidden="true" />
}

export function StatusControl({ label, title, tooltipTitle = title, ariaLabel = title, severity, tooltip, details }: {
  label: React.ReactNode
  title: string
  tooltipTitle?: string
  ariaLabel?: string
  severity: StatusSeverity
  tooltip: React.ReactNode
  details: React.ReactNode
}): React.JSX.Element {
  const { t } = useI18n()
  const [detailsOpen, setDetailsOpen] = React.useState(false)
  const [tooltipOpen, setTooltipOpen] = React.useState(false)

  return <div className="app-no-drag flex min-w-0 items-center">
    <TooltipProvider>
      <Popover open={detailsOpen} onOpenChange={setDetailsOpen}>
        <Tooltip open={tooltipOpen && !detailsOpen} onOpenChange={setTooltipOpen}>
          <TooltipTrigger asChild><PopoverTrigger asChild>
            <button type="button" className="flex min-w-0 items-center gap-1.5 rounded-sm px-1 text-left outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring" aria-label={ariaLabel} onClick={() => setTooltipOpen(false)}>
              <StatusDot severity={severity} />
              {label}
            </button>
          </PopoverTrigger></TooltipTrigger>
          <TooltipContent side="top" align="start" sideOffset={6} showArrow={false} className="block w-[min(15rem,calc(100vw-1rem))] max-w-none overflow-hidden rounded-lg border bg-popover p-0 text-popover-foreground shadow-md">
            <div className="line-clamp-2 px-2 pt-1.5 pb-0.5 text-[11px] font-semibold">{tooltipTitle}</div>
            <div className="px-2 py-0.5">{tooltip}</div>
          </TooltipContent>
        </Tooltip>
        <PopoverContent side="top" align="start" sideOffset={6} aria-label={t('status.details')} className="w-[min(17rem,calc(100vw-1rem))] gap-0 overflow-hidden rounded-lg p-0 text-xs">
          <PopoverHeader className="flex-row items-center justify-between gap-2 px-2 py-1">
            <PopoverTitle className="min-w-0 line-clamp-2 text-[11px]">{title}</PopoverTitle>
            <Button variant="ghost" size="icon-xs" className="size-5" aria-label={t('common.close')} onClick={() => setDetailsOpen(false)}><X className="size-3.5" /></Button>
          </PopoverHeader>
          <div className="max-h-[min(20rem,55vh)] overflow-y-auto select-text break-words [overflow-wrap:anywhere]">{details}</div>
        </PopoverContent>
      </Popover>
    </TooltipProvider>
  </div>
}

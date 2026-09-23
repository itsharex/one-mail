import * as React from 'react'
import { CircleHelp } from 'lucide-react'
import { Field, FieldError, FieldLabel } from '@renderer/components/ui/field'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@renderer/components/ui/tooltip'

export function SettingsHelp({ description, focusable = true }: { description: string; focusable?: boolean }): React.JSX.Element {
  return <TooltipProvider><Tooltip>
    <TooltipTrigger asChild><span tabIndex={focusable ? 0 : undefined} role="img" aria-label={description} onClick={(event) => event.stopPropagation()} className="inline-flex size-4 shrink-0 cursor-help items-center justify-center rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"><CircleHelp className="size-3.5" aria-hidden="true" /></span></TooltipTrigger>
    <TooltipContent side="top" className="max-w-64 leading-5">{description}</TooltipContent>
  </Tooltip></TooltipProvider>
}

export function SettingsGroup({
  title,
  children
}: {
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="grid gap-1.5">
      <div className="px-0.5">
        <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      </div>
      {children}
    </section>
  )
}

export function SettingRow({
  icon: Icon,
  title,
  description,
  control,
  error,
  invalid = false
}: {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
  title: string
  description: React.ReactNode
  control?: React.ReactNode
  error?: string
  invalid?: boolean
}): React.JSX.Element {
  return (
    <Field data-invalid={invalid || undefined}>
      <div className="grid min-h-10 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <div
            className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted/70 text-muted-foreground [&_svg]:size-3.5"
          >
            <Icon aria-hidden="true" />
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <FieldLabel className="text-[13px] font-medium">{title}</FieldLabel>
            {typeof description === 'string' ? <SettingsHelp description={description} /> : <span className="text-[11px] text-muted-foreground">{description}</span>}
            <FieldError className="basis-full text-xs">{error}</FieldError>
          </div>
        </div>
        {control ? <div className="flex justify-end">{control}</div> : null}
      </div>
    </Field>
  )
}

export const SETTINGS_LIST_CLASS =
  'gap-0 overflow-hidden rounded-lg bg-background [&>[data-slot=field]+[data-slot=field]]:border-t [&>[data-slot=field]+[data-slot=field]]:border-border/40'

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type

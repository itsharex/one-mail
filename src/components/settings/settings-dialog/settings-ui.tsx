import * as React from 'react'
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel } from '@renderer/components/ui/field'

export function SettingsGroup({
  title,
  children
}: {
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="grid gap-1.5">
      <div className="flex min-h-5 items-center gap-2 px-1">
        <h3 className="text-[11px] font-medium text-muted-foreground">{title}</h3>
      </div>
      {children}
    </section>
  )
}

export function SettingRow({
  icon: Icon,
  iconClassName,
  title,
  description,
  control,
  error,
  invalid = false
}: {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
  iconClassName: string
  title: string
  description: React.ReactNode
  control?: React.ReactNode
  error?: string
  invalid?: boolean
}): React.JSX.Element {
  return (
    <Field data-invalid={invalid || undefined}>
      <div className="grid min-h-12 gap-2 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="flex min-w-0 gap-2.5">
          <div
            className={`mt-px flex size-7 shrink-0 items-center justify-center rounded-md text-white shadow-sm [&_svg]:size-3.5 ${iconClassName}`}
          >
            <Icon aria-hidden="true" />
          </div>
          <FieldContent>
            <FieldLabel className="text-xs font-medium">{title}</FieldLabel>
            <FieldDescription className="text-xs leading-tight">{description}</FieldDescription>
            <FieldError className="text-xs">{error}</FieldError>
          </FieldContent>
        </div>
        {control ? <div className="flex justify-start sm:justify-end">{control}</div> : null}
      </div>
    </Field>
  )
}

export const SETTINGS_LIST_CLASS =
  'gap-0 overflow-hidden rounded-lg bg-background shadow-sm ring-1 ring-black/5 dark:ring-white/8 [&>[data-slot=field]+[data-slot=field]]:border-t [&>[data-slot=field]+[data-slot=field]]:border-border/60'

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type

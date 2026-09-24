import * as React from 'react'
import { ChevronRight } from 'lucide-react'

import { StatusControl, type StatusSeverity } from '@renderer/components/status-control'
import { PopoverClose } from '@renderer/components/ui/popover'
import { useI18n } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'

export type GlobalStatusItem = {
  key: string
  label?: string
  text: string
  title?: string
  active?: boolean
  severity: StatusSeverity
  onSelect?: () => void
}

export function GlobalStatus({ items }: { items: GlobalStatusItem[] }): React.JSX.Element {
  const { t } = useI18n()
  const [online, setOnline] = React.useState(() => navigator.onLine)

  React.useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine)
    window.addEventListener('online', updateOnline)
    window.addEventListener('offline', updateOnline)
    window.addEventListener('focus', updateOnline)
    return () => {
      window.removeEventListener('online', updateOnline)
      window.removeEventListener('offline', updateOnline)
      window.removeEventListener('focus', updateOnline)
    }
  }, [])

  const networkText = online ? t('status.networkOnline') : t('status.networkOffline')
  const overallSeverity = items.some((item) => item.severity === 'danger')
    ? 'danger'
    : !online || items.some((item) => item.severity === 'warning')
      ? 'warning'
      : 'normal'
  const overallText = !online
    ? networkText
    : overallSeverity === 'danger'
      ? t('status.overallDanger')
      : overallSeverity === 'warning'
        ? t('status.appStatus')
        : items.some((item) => item.active)
          ? t('status.overallChecking')
          : t('status.overallNormal')

  return <StatusControl
    title={overallText}
    tooltipTitle={overallText}
    ariaLabel={overallSeverity === 'warning' && online ? t('status.details') : `${t('status.appStatus')}：${overallText}`}
    severity={overallSeverity}
    label={overallSeverity === 'warning' && online ? null : <span className="min-w-0 truncate text-foreground">{overallText}</span>}
    tooltip={<>
      <StatusRow label={t('status.categoryNetwork')} severity={online ? 'normal' : 'warning'} text={networkText} />
      {items.map((item) => <StatusRow key={item.key} label={item.label} severity={item.severity} text={item.text} title={item.title} />)}
    </>}
    details={<>
      <div className="px-2 py-0.5">
        <StatusRow label={t('status.categoryNetwork')} severity={online ? 'normal' : 'warning'} text={networkText} />
        {items.map((item) => <StatusRow key={item.key} label={item.label} severity={item.severity} text={item.text} title={item.title} onSelect={item.onSelect} />)}
      </div>
    </>}
  />
}

function StatusRow({ label, severity, text, title, onSelect }: Omit<GlobalStatusItem, 'key'>): React.JSX.Element {
  const className = cn('grid w-full grid-cols-[3rem_minmax(0,1fr)] items-center gap-x-2 py-0.5 text-[11px] leading-4', onSelect && 'rounded text-left outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring')
  const content = <>
    {label && <span className="truncate text-muted-foreground">{label}</span>}
    <span aria-description={title && title !== text ? title : undefined} className={cn('flex min-w-0 items-center justify-end gap-0.5', severity === 'danger' && 'text-destructive', severity === 'warning' && 'text-amber-700 dark:text-warning')}>
      <span className="truncate">{text}</span>
      {onSelect && <ChevronRight className="size-3 shrink-0" aria-hidden="true" />}
    </span>
  </>
  return onSelect
    ? <PopoverClose asChild><button type="button" className={className} onClick={onSelect}>{content}</button></PopoverClose>
    : <div className={className}>{content}</div>
}

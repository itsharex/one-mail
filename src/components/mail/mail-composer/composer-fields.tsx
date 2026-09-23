import * as React from 'react'
import { FieldLabel } from '@renderer/components/ui/field'
import { Button } from '@renderer/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { useI18n } from '@renderer/lib/i18n'

export function ComposerFieldLabel({
  htmlFor,
  children
}: {
  htmlFor: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <FieldLabel
      htmlFor={htmlFor}
      className="w-12 shrink-0 justify-start text-left text-xs text-muted-foreground"
    >
      {children}
    </FieldLabel>
  )
}

export function RecipientDisclosure({
  ccVisible,
  bccVisible,
  disabled,
  onShowCc,
  onShowBcc
}: {
  ccVisible: boolean
  bccVisible: boolean
  disabled: boolean
  onShowCc: () => void
  onShowBcc: () => void
}): React.JSX.Element | null {
  const { t } = useI18n()

  if (ccVisible && bccVisible) return null

  return (
    <div className="flex shrink-0 items-center gap-1.5 text-xs">
      {!ccVisible ? (
        <button
          type="button"
          className="text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          disabled={disabled}
          onClick={onShowCc}
        >
          {t('mail.composer.cc')}
        </button>
      ) : null}
      {!bccVisible ? (
        <button
          type="button"
          className="text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          disabled={disabled}
          onClick={onShowBcc}
        >
          {t('mail.composer.bcc')}
        </button>
      ) : null}
    </div>
  )
}

export function ComposerToolButton({
  label,
  active,
  disabled,
  onMouseDown,
  onClick,
  children
}: {
  label: string
  active?: boolean
  disabled?: boolean
  onMouseDown?: (event: React.MouseEvent<HTMLButtonElement>) => void
  onClick?: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={active ? 'secondary' : 'ghost'}
          size="icon-xs"
          aria-label={label}
          aria-pressed={active}
          disabled={disabled}
          onMouseDown={onMouseDown}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

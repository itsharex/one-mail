import * as React from 'react'
import { AlertTriangle, KeyRound, RefreshCw } from 'lucide-react'

import type { Account } from '@renderer/components/mail/types'
import { Alert, AlertDescription } from '@renderer/components/ui/alert'
import { Button } from '@renderer/components/ui/button'
import { FieldError } from '@renderer/components/ui/field'
import { useI18n } from '@renderer/lib/i18n'
import { getAccountWarning, type AccountWarningAction } from './account-warning'

type AccountWarningDialogProps = {
  account: Account
  open: boolean
  syncing?: boolean
  onOpenChange: (open: boolean) => void
  onEdit: (account: Account) => void
  onRetry: (account: Account) => void
  onDelete: (account: Account) => void
  onReauthorize: (account: Account) => Promise<void>
}

export function AccountWarningDialog({
  account,
  open,
  syncing = false,
  onOpenChange,
  onEdit,
  onRetry,
  onDelete,
  onReauthorize
}: AccountWarningDialogProps): React.JSX.Element {
  const { t } = useI18n()
  const [pendingAccountIds, setPendingAccountIds] = React.useState<Set<string>>(new Set())
  const [errorsByAccount, setErrorsByAccount] = React.useState<Record<string, string>>({})
  const pending = pendingAccountIds.has(account.id)
  const error = errorsByAccount[account.id]
  const warning = getAccountWarning(account, t)

  function handleOpenChange(nextOpen: boolean): void {
    if (!nextOpen) {
      setErrorsByAccount((current) => {
        const next = { ...current }
        delete next[account.id]
        return next
      })
    }
    onOpenChange(nextOpen)
  }

  async function runAction(action?: AccountWarningAction): Promise<void> {
    if (!action) return

    if (action === 'reauthorize') {
      if (pendingAccountIds.has(account.id)) return
      setPendingAccountIds((current) => new Set(current).add(account.id))
      setErrorsByAccount((current) => {
        const next = { ...current }
        delete next[account.id]
        return next
      })
      try {
        await onReauthorize(account)
      } catch (reauthorizeError) {
        setErrorsByAccount((current) => ({
          ...current,
          [account.id]: reauthorizeError instanceof Error
            ? reauthorizeError.message
            : t('account.warning.reauthorizeError')
        }))
      } finally {
        setPendingAccountIds((current) => {
          const next = new Set(current)
          next.delete(account.id)
          return next
        })
      }
      return
    }

    handleOpenChange(false)

    if (action === 'edit') {
      onEdit(account)
      return
    }

    if (action === 'delete') {
      onDelete(account)
      return
    }

    onRetry(account)
  }

  const disabled = syncing || pending
  const primaryAuthorizing = pending && warning?.primaryAction === 'reauthorize'
  const secondaryAuthorizing = pending && warning?.secondaryAction === 'reauthorize'

  if (!open || !warning) return <></>

  return (
    <aside className="app-no-drag fixed right-4 bottom-10 z-40 w-[min(380px,calc(100vw-2rem))] rounded-lg border bg-popover p-4 text-popover-foreground shadow-lg">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{warning.title}</h2>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{account.address || account.name}</p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 cursor-pointer px-2 text-xs"
          onClick={() => handleOpenChange(false)}
        >
          {t('common.later')}
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        <Alert variant="warning">
          <AlertTriangle aria-hidden="true" strokeWidth={2} />
          <AlertDescription>{warning.message}</AlertDescription>
        </Alert>

        {warning.steps.length === 1 ? (
          <p className="text-xs leading-5 text-muted-foreground">{warning.steps[0]}</p>
        ) : (
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-xs text-muted-foreground">
            {warning.steps.map((step) => <li key={step}>{step}</li>)}
          </ol>
        )}
        {error ? <FieldError>{error}</FieldError> : null}
      </div>

      <div className="mt-4 flex justify-end gap-2 border-t pt-3">
        {warning.secondaryAction ? (
          <Button
            size="sm"
            variant={secondaryAuthorizing ? 'default' : 'outline'}
            className={secondaryAuthorizing
              ? 'cursor-progress disabled:pointer-events-auto disabled:opacity-100'
              : 'cursor-pointer disabled:pointer-events-auto disabled:cursor-not-allowed'}
            aria-busy={secondaryAuthorizing}
            onClick={() => { void runAction(warning.secondaryAction) }}
            disabled={disabled}
          >
            {secondaryAuthorizing ? <RefreshCw className="animate-spin" data-icon="inline-start" /> :
              warning.secondaryAction === 'retry' ? <RefreshCw data-icon="inline-start" /> :
              warning.secondaryAction === 'reauthorize' ? <KeyRound data-icon="inline-start" /> : null}
            {secondaryAuthorizing ? t('account.warning.authorizing') : warning.secondaryLabel}
          </Button>
        ) : null}
        <Button
          size="sm"
          variant={secondaryAuthorizing ? 'outline' : 'default'}
          className={primaryAuthorizing
            ? 'cursor-progress disabled:pointer-events-auto disabled:opacity-100'
            : 'cursor-pointer disabled:pointer-events-auto disabled:cursor-not-allowed'}
          aria-busy={primaryAuthorizing}
          onClick={() => { void runAction(warning.primaryAction) }}
          disabled={disabled}
        >
          {primaryAuthorizing ? <RefreshCw className="animate-spin" data-icon="inline-start" /> :
            warning.primaryAction === 'retry' ? <RefreshCw data-icon="inline-start" /> :
            warning.primaryAction === 'reauthorize' ? <KeyRound data-icon="inline-start" /> : null}
          {primaryAuthorizing ? t('account.warning.authorizing') : warning.primaryLabel}
        </Button>
      </div>
    </aside>
  )
}

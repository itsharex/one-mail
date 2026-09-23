import type { AppSettings, AppUpdateStatus, SystemInfo } from '@renderer/shared/types'
import type { Account } from '@renderer/components/mail/types'
import * as React from 'react'
import { useIsFetching } from '@tanstack/react-query'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import {
  ChevronDown,
  CloudDownload,
  FileUp,
  Inbox,
  Link,
  Plus,
  RotateCcw,
  Settings,
  Upload,
  X
} from 'lucide-react'

import type { BackupImportDialogSource } from '@renderer/components/backup/backup-import-dialog'
import { ThemeToggleButton } from '@renderer/components/theme/theme-toggle-button'
import { SweepShine } from '@renderer/components/sweep-shine'
import { Button } from '@renderer/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@renderer/components/ui/empty'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@renderer/components/ui/tooltip'

import type { SyncNotice } from './use-sync-feedback'
import { formatSyncNotice } from './use-sync-feedback'
import { useI18n } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import { hasAvailableUpdate } from '@renderer/lib/update-status'
import { startWindowDrag } from '@renderer/lib/window-drag'

export function NoAccountsBody({
  importingSql,
  actionsDisabled = false,
  onAddAccount,
  onImportBackup
}: {
  importingSql: boolean
  actionsDisabled?: boolean
  onAddAccount: () => void
  onImportBackup: (source: BackupImportDialogSource) => void
}): React.JSX.Element {
  const { t } = useI18n()

  return (
    <Empty className="min-h-0 flex-1 rounded-none border-0">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Inbox aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>{t('mailbox.noAccounts.title')}</EmptyTitle>
        <EmptyDescription>{t('mailbox.noAccounts.description')}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex flex-col gap-2 sm:flex-row">
        <Button onClick={onAddAccount} disabled={actionsDisabled}>
          <Plus data-icon="inline-start" />
          {t('common.addAccount')}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" disabled={actionsDisabled}>
              <Upload data-icon="inline-start" />
              {importingSql ? t('mailbox.importing') : t('settings.backup.importMenu')}
              <ChevronDown data-icon="inline-end" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" className="w-48 min-w-48 rounded-md p-1">
            <DropdownMenuGroup>
              <DropdownMenuItem
                className="h-8 cursor-pointer gap-2 whitespace-nowrap px-2 text-sm"
                onSelect={() => onImportBackup('sql')}
              >
                <FileUp />
                <span className="truncate">{t('settings.backup.importSqlMenu')}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="h-8 cursor-pointer gap-2 whitespace-nowrap px-2 text-sm"
                onSelect={() => onImportBackup('webdav')}
              >
                <Link />
                <span className="truncate">{t('settings.backup.importWebDavMenu')}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="h-8 cursor-pointer gap-2 whitespace-nowrap px-2 text-sm"
                onSelect={() => onImportBackup('s3')}
              >
                <CloudDownload />
                <span className="truncate">{t('settings.backup.importS3Menu')}</span>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </EmptyContent>
    </Empty>
  )
}

export function TitleBar({
  platform,
  onAddAccount,
  onOpenSettings
}: {
  platform?: SystemInfo['platform'] | null
  onAddAccount: () => void
  onOpenSettings: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const placeActionsOnLeft = Boolean(platform && platform !== 'darwin')

  return (
    <header
      className={cn(
        'app-titlebar app-drag-region native-sidebar-titlebar flex h-12 shrink-0 items-center border-b border-black/5 dark:border-white/8',
        placeActionsOnLeft ? 'justify-start' : 'justify-end'
      )}
      onMouseDown={startWindowDrag}
    >
      <TooltipProvider>
        <div className="app-no-drag flex items-center gap-1">
          {placeActionsOnLeft ? (
            <>
              <SettingsButton label={t('common.settings')} onClick={onOpenSettings} />
              <AddAccountButton label={t('common.addAccount')} onClick={onAddAccount} />
              <ThemeToggleButton />
            </>
          ) : (
            <>
              <AddAccountButton label={t('common.addAccount')} onClick={onAddAccount} />
              <SettingsButton label={t('common.settings')} onClick={onOpenSettings} />
              <ThemeToggleButton />
            </>
          )}
        </div>
      </TooltipProvider>
    </header>
  )
}

function AddAccountButton({
  label,
  onClick
}: {
  label: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="rounded-lg text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/8"
          aria-label={label}
          onClick={onClick}
        >
          <Plus aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

function SettingsButton({
  label,
  onClick
}: {
  label: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="rounded-lg text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/8"
          aria-label={label}
          onClick={onClick}
        >
          <Settings aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

export function StatusBar({
  loading,
  selectedAccount,
  accountAddresses,
  systemInfo,
  settings,
  accountCount,
  messageCount,
  syncNotice,
  error,
  updateStatus,
  onOpenVersion,
  onInstallUpdate
}: {
  loading: boolean
  selectedAccount: Account
  accountAddresses: string[]
  systemInfo: SystemInfo | null
  settings: AppSettings | null
  accountCount: number
  messageCount: number
  syncNotice: SyncNotice
  error?: string | null
  updateStatus: AppUpdateStatus | null
  onOpenVersion: () => void
  onInstallUpdate: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const loadingConversations = useIsFetching({ queryKey: ['conversations', 'list', selectedAccount.accountId ?? null] }) > 0
  const loadingMessages = useIsFetching({ queryKey: ['conversations', 'messages', selectedAccount.accountId ?? null] }) > 0
  const syncText = formatSyncNotice(syncNotice, t)
  const idleText = syncText ? '' : error || (loading
    ? t('status.databaseLoading')
    : loadingConversations
      ? selectedAccount.accountId
        ? t('status.loadingConversations', { account: selectedAccount.address })
        : t('status.loadingAllConversations', { count: accountCount })
      : loadingMessages
        ? selectedAccount.accountId
          ? t('status.loadingMessages', { account: selectedAccount.address })
          : t('status.loadingAllMessages')
        : t('status.ready'))
  const ready = !syncText && !error && !loading && !loadingConversations && !loadingMessages
  const idleTitle = !selectedAccount.accountId && loadingConversations
    ? `${idleText}\n${accountAddresses.join('\n')}`
    : idleText
  const syncActivityText = syncNotice.state === 'running' && syncNotice.activity
    ? `${syncNotice.activity.account} · ${formatSyncStep(syncNotice.activity.stage, t)}${syncNotice.activity.folder ? ` · ${syncNotice.activity.folder}` : ''}`
    : syncText
  const updateText = formatUpdateStatus(updateStatus, t)
  const hasUpdate = hasAvailableUpdate(updateStatus)
  const [activeDetails, setActiveDetails] = React.useState<'sync' | 'update' | null>(null)
  const syncProgress = syncNotice.state === 'running' && syncNotice.progress?.total
    ? Math.min(100, Math.max(0, syncNotice.progress.completed / syncNotice.progress.total * 100))
    : null
  const updateProgress = updateStatus?.state === 'downloading' && updateStatus.progress
    ? Math.min(100, Math.max(0, updateStatus.progress.percent))
    : null
  React.useEffect(() => {
    if (error && syncNotice.state !== 'running' && syncNotice.state !== 'error') toast.error(error, { duration: 8000 })
  }, [error, syncNotice.state])
  React.useEffect(() => {
    if (!activeDetails) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActiveDetails(null)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [activeDetails])
  const versionLabel = systemInfo?.appVersion ? `v${systemInfo.appVersion}` : '...'
  const versionTitle =
    hasUpdate && updateStatus?.latestVersion
      ? t('status.openHomepageForUpdate', { version: updateStatus.latestVersion })
      : hasUpdate
        ? t('status.openHomepageForUpdateGeneric')
        : t('status.openRepository')

  return (
    <>
    <footer className="app-drag-region native-statusbar flex h-7 shrink-0 items-center justify-between gap-2 border-t px-2 text-[11px] text-muted-foreground">
      <div className="app-no-drag flex min-w-0 items-center gap-1.5 overflow-hidden">
        {idleText && <span role="status" className={cn('flex min-w-0 items-center gap-1.5 text-foreground', error && 'text-destructive')} title={idleTitle}>
          <StatusDot active={!ready && !error} error={Boolean(error)} />
          <span className="min-w-0 truncate">{!ready && !error ? <SweepShine>{idleText}</SweepShine> : idleText}</span>
        </span>}
        {syncText ? (
          <button type="button" className={cn('flex min-w-0 max-w-[min(55vw,30rem)] items-center gap-1.5 text-left text-foreground hover:underline', syncNotice.state === 'error' && 'text-destructive')} title={syncActivityText} aria-expanded={activeDetails === 'sync'} onClick={() => setActiveDetails(activeDetails === 'sync' ? null : 'sync')}>
            <StatusDot active={syncNotice.state === 'running'} error={syncNotice.state === 'error'} />
            <span className="truncate">{syncNotice.state === 'running' ? <SweepShine>{syncActivityText}</SweepShine> : syncText}</span>
            {syncNotice.state === 'running' && syncNotice.progress && <span className="shrink-0 text-muted-foreground">{syncNotice.progress.completed}/{syncNotice.progress.total}</span>}
            {syncProgress !== null && <SyncRing percent={syncProgress} />}
          </button>
        ) : null}
      </div>
      <div className="app-no-drag ml-auto flex min-w-0 items-center justify-end gap-1.5 overflow-hidden">
        {updateText ? (
          <button type="button" className="max-w-[min(40vw,24rem)] truncate rounded-sm bg-background/60 px-1.5 text-left text-foreground hover:underline" title={updateText} aria-expanded={activeDetails === 'update'} onClick={() => setActiveDetails(activeDetails === 'update' ? null : 'update')}>
            {updateStatus?.state === 'checking' || updateStatus?.state === 'downloading' || updateStatus?.state === 'installing' ? <SweepShine>{updateText}</SweepShine> : updateText}
            {updateProgress !== null && <span className="ml-1 inline-block h-1 w-10 overflow-hidden rounded-full bg-muted align-middle" aria-hidden="true"><span className="block h-full rounded-full bg-primary" style={{ width: `${updateProgress}%` }} /></span>}
          </button>
        ) : null}
        {updateStatus?.state === 'downloaded' ? (
          <Button className="h-5 rounded-sm px-1.5 text-xs" size="xs" onClick={onInstallUpdate}>
            <RotateCcw data-icon="inline-start" />
            {t('status.updateRestart')}
          </Button>
        ) : null}
        <span className="hidden shrink-0 sm:inline">
          {t('status.accounts', { count: accountCount })}
        </span>
        <span className="hidden shrink-0 sm:inline" aria-hidden="true">
          ·
        </span>
        <span className="shrink-0">{t('status.messages', { count: messageCount })}</span>
        <span
          className="hidden shrink-0 lg:inline"
          title={t('status.cacheDays', { days: settings?.syncWindowDays ?? 90 })}
        >
          · {t('status.cacheDays', { days: settings?.syncWindowDays ?? 90 })}
        </span>
        <button
          type="button"
          className={cn(
            'outline-none transition-colors hover:text-foreground focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60',
            hasUpdate && 'font-medium text-warning hover:text-warning'
          )}
          title={versionTitle}
          aria-label={versionTitle}
          disabled={!systemInfo?.appVersion}
          onClick={onOpenVersion}
        >
          {versionLabel}
        </button>
      </div>
    </footer>
    {activeDetails && (activeDetails === 'sync' ? syncText : updateText) ? createPortal(
      <section role="dialog" aria-label={activeDetails === 'sync' ? t('status.syncDetails') : t('status.updateDetails')} className="fixed right-3 bottom-10 z-50 flex w-[min(26rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-xl">
        <header className="flex items-center justify-between border-b px-3 py-1.5 text-xs font-medium">
          <span>{activeDetails === 'sync' ? t('status.syncDetails') : t('status.updateDetails')}</span>
          <Button variant="ghost" size="icon-sm" className="size-5" aria-label={t('common.close')} onClick={() => setActiveDetails(null)}><X className="size-3.5" /></Button>
        </header>
        <div className="max-h-[min(24rem,60vh)] overflow-y-auto text-xs leading-5 select-text break-words [overflow-wrap:anywhere]">
          {activeDetails === 'sync' ? <>
            <div className="space-y-1 border-b bg-muted/30 px-3 py-2">
              <div className="flex items-center gap-2 font-medium">
                {syncProgress !== null ? <SyncRing percent={syncProgress} /> : syncNotice.state !== 'running' ? <span className={cn('size-2 rounded-full', syncNotice.state === 'error' ? 'bg-destructive' : 'bg-primary')} aria-hidden="true" /> : null}
                <span className={syncNotice.state === 'error' ? 'text-destructive' : undefined}>{syncNotice.state === 'running' ? <SweepShine>{t('sync.running')}</SweepShine> : syncNotice.state === 'success' ? t('sync.success') : t('sync.error')}</span>
                {syncNotice.progress && <span className="ml-auto tabular-nums text-muted-foreground">{syncNotice.progress.completed}/{syncNotice.progress.total}</span>}
              </div>
              {syncNotice.state !== 'running' && <p className={syncNotice.state === 'error' ? 'text-destructive' : 'text-muted-foreground'}>{syncText}</p>}
            </div>
            {syncNotice.steps && syncNotice.steps.length > 0 && <ol className="py-1 font-mono text-[11px] leading-5">{syncNotice.steps.map((step, index) => <li key={index} className="flex gap-2 px-3 py-1 even:bg-muted/25">
              <span className="shrink-0 select-none tabular-nums text-muted-foreground/60">{String(index + 1).padStart(2, '0')}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground" title={step.account}>{step.account}</span>
              <span className="shrink-0 text-foreground">{formatSyncStep(step.stage, t)}</span>
              {step.folder && <span className="min-w-0 truncate text-muted-foreground" title={step.folder}>{step.folder}</span>}
            </li>)}</ol>}
          </> : <div className="px-3 py-2">
            <p>{updateText}</p>
            {updateStatus?.message && updateStatus.message !== updateText && <p className="text-muted-foreground">{updateStatus.message}</p>}
            {updateProgress !== null && <div role="progressbar" aria-label={t('status.updateDetails')} aria-valuenow={Math.round(updateProgress)} aria-valuemin={0} aria-valuemax={100} className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${updateProgress}%` }} /></div>}
          </div>}
        </div>
        <footer className="flex justify-end gap-1.5 border-t px-3 py-1.5">
          {activeDetails === 'update' && updateStatus?.state === 'downloaded' && <Button size="xs" onClick={onInstallUpdate}>{t('status.updateRestart')}</Button>}
          {activeDetails === 'update' && hasUpdate && updateStatus?.state !== 'downloaded' && <Button size="xs" onClick={onOpenVersion}>{t('status.openUpdatePage')}</Button>}
          <Button variant="outline" size="xs" onClick={() => setActiveDetails(null)}>{t('common.close')}</Button>
        </footer>
      </section>, document.body
    ) : null}
    </>
  )
}

function StatusDot({ active, error }: { active: boolean; error: boolean }): React.JSX.Element {
  return <span className="relative flex size-2 shrink-0 items-center justify-center" aria-hidden="true">
    {active && <span className="absolute size-2 rounded-full bg-primary/30 motion-safe:animate-ping [animation-duration:2s]" />}
    <span className={cn('relative size-1.5 rounded-full', error ? 'bg-destructive' : 'bg-primary')} />
  </span>
}

function SyncRing({ percent, size = 14 }: { percent: number; size?: number }): React.JSX.Element {
  return <svg width={size} height={size} viewBox="0 0 24 24" className="shrink-0 text-primary" aria-hidden="true">
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth="3" />
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray={2 * Math.PI * 9} strokeDashoffset={2 * Math.PI * 9 * (1 - percent / 100)} transform="rotate(-90 12 12)" />
  </svg>
}

function formatSyncStep(stage: string, t: ReturnType<typeof useI18n>['t']): string {
  switch (stage) {
    case 'connecting': return t('status.syncConnecting')
    case 'requesting': return t('status.syncRequesting')
    case 'folder': return t('status.syncFolder')
    case 'fetching': return t('status.syncFetching')
    case 'saving': return t('status.syncSaving')
    case 'complete': return t('status.syncAccountComplete')
    case 'failed': return t('status.syncAccountFailed')
    case 'skipped': return t('status.syncAccountSkipped')
    default: return t('sync.running')
  }
}

function formatUpdateStatus(
  status: AppUpdateStatus | null,
  t: ReturnType<typeof useI18n>['t']
): string | null {
  if (!status || status.state === 'idle' || status.state === 'unsupported') return null

  if (status.state === 'checking') return t('status.updateChecking')
  if (status.state === 'downloading') {
    return t('status.updateDownloading', {
      percent: Math.round(status.progress?.percent ?? 0)
    })
  }
  if (status.state === 'downloaded') return t('status.updateDownloaded')
  if (status.state === 'installing') return t('status.updateInstalling')
  if (status.state === 'available') {
    return t('status.updateAvailable', { version: status.latestVersion ?? '' })
  }
  if (status.state === 'not_available') return t('status.updateNotAvailable')
  if (status.state === 'error') return t('status.updateError')

  return null
}

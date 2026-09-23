import type { AppSettings, AppUpdateStatus, SystemInfo } from '@renderer/shared/types'
import * as React from 'react'
import { createPortal } from 'react-dom'
import {
  AlertCircle,
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
  systemInfo,
  settings,
  accountCount,
  messageCount,
  syncNotice,
  error,
  syncErrors = [],
  onDismissError,
  updateStatus,
  onOpenVersion,
  onInstallUpdate
}: {
  systemInfo: SystemInfo | null
  settings: AppSettings | null
  accountCount: number
  messageCount: number
  syncNotice: SyncNotice
  error?: string | null
  syncErrors?: string[]
  onDismissError?: () => void
  updateStatus: AppUpdateStatus | null
  onOpenVersion: () => void
  onInstallUpdate: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const syncText = formatSyncNotice(syncNotice, t)
  const updateText = formatUpdateStatus(updateStatus, t)
  const hasUpdate = hasAvailableUpdate(updateStatus)
  const [activeDetails, setActiveDetails] = React.useState<'sync' | 'update' | null>(null)
  React.useEffect(() => {
    if (syncNotice.state === 'error' || syncErrors.length > 0) setActiveDetails('sync')
  }, [syncNotice.state, syncNotice.finishedAt, syncErrors.length])
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
    {(error || syncErrors.length > 0) && <section role="alert" className="shrink-0 border-t border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
      <div className="mb-1 flex items-center gap-1.5 font-medium">
        <AlertCircle className="size-3.5" aria-hidden="true" />
        <span className="flex-1">{t('mailbox.errorDetails')}</span>
        {onDismissError && <Button variant="ghost" size="icon-sm" className="size-5 text-destructive" onClick={onDismissError} aria-label={t('common.close')}><X className="size-3.5" /></Button>}
      </div>
      <div className="max-h-32 select-text overflow-y-auto whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
        {error && <p>{error}</p>}
        {syncErrors.length > 0 && <ul className="space-y-1">{syncErrors.map((message, index) => <li key={index}>{message}</li>)}</ul>}
      </div>
    </section>}
    <footer className="app-drag-region native-statusbar flex h-7 shrink-0 items-center justify-end border-t px-2 text-[11px] text-muted-foreground">
      <div className="app-no-drag flex min-w-0 items-center justify-end gap-1.5 overflow-hidden">
        {syncText ? (
          <button type="button" className={cn('flex min-w-0 max-w-[min(40vw,24rem)] items-center gap-1 text-left text-foreground hover:underline', syncNotice.state === 'error' && 'text-destructive')} title={syncText} aria-expanded={activeDetails === 'sync'} onClick={() => setActiveDetails(activeDetails === 'sync' ? null : 'sync')}>
            <span className={cn('size-1.5 shrink-0 rounded-full', syncNotice.state === 'error' ? 'bg-destructive' : 'bg-primary')} aria-hidden="true" />
            <span className="truncate">{syncNotice.state === 'running' ? <SweepShine>{syncText}</SweepShine> : syncText}</span>
          </button>
        ) : null}
        {updateText ? (
          <button type="button" className="max-w-[min(40vw,24rem)] truncate rounded-sm bg-background/60 px-1.5 text-left text-foreground hover:underline" title={updateText} aria-expanded={activeDetails === 'update'} onClick={() => setActiveDetails(activeDetails === 'update' ? null : 'update')}>
            {updateStatus?.state === 'checking' || updateStatus?.state === 'downloading' || updateStatus?.state === 'installing' ? <SweepShine>{updateText}</SweepShine> : updateText}
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
      <section role="dialog" aria-label={activeDetails === 'sync' ? t('status.syncDetails') : t('status.updateDetails')} className="fixed right-3 bottom-10 z-50 flex w-[min(20rem,calc(100vw-1.5rem))] flex-col rounded-lg border bg-popover text-popover-foreground shadow-xl">
        <header className="flex items-center justify-between border-b px-3 py-1.5 text-xs font-medium">
          <span>{activeDetails === 'sync' ? t('status.syncDetails') : t('status.updateDetails')}</span>
          <Button variant="ghost" size="icon-sm" className="size-5" aria-label={t('common.close')} onClick={() => setActiveDetails(null)}><X className="size-3.5" /></Button>
        </header>
        <div className="max-h-48 overflow-y-auto px-3 py-2 text-xs leading-5 select-text break-words [overflow-wrap:anywhere]">
          {activeDetails === 'sync' ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <span className={cn('font-medium', syncNotice.state === 'error' && 'text-destructive')}>{syncNotice.state === 'running' ? t('sync.running') : syncNotice.state === 'success' ? t('sync.success') : t('sync.error')}</span>
                {syncNotice.startedAt && syncNotice.finishedAt && <span className="shrink-0 text-muted-foreground">{t('status.syncDuration', { seconds: Math.max(1, Math.round((syncNotice.finishedAt.getTime() - syncNotice.startedAt.getTime()) / 1000)) })}</span>}
              </div>
              {syncNotice.label && <p className="text-muted-foreground">{syncNotice.label}</p>}
              {syncNotice.state === 'running' && <p><SweepShine>{syncText}</SweepShine></p>}
              {syncNotice.state === 'success' && syncNotice.message && <p>{syncNotice.message}</p>}
              {syncNotice.state === 'error' && <p className="text-destructive">{syncNotice.message}</p>}
              {syncErrors.length > 0 && <ul className="space-y-1 text-destructive">{syncErrors.map((message, index) => <li key={index}>{message}</li>)}</ul>}
            </div>
          ) : (
            <>
              <p>{updateText}</p>
              {updateStatus?.message && updateStatus.message !== updateText && <p className="text-muted-foreground">{updateStatus.message}</p>}
            </>
          )}
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

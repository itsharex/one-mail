import type { AppSettings, AppUpdateStatus, SystemInfo } from '@renderer/shared/types'
import type { Account } from '@renderer/components/mail/types'
import * as React from 'react'
import { gsap } from 'gsap'
import { toast } from 'sonner'
import { listen } from '@tauri-apps/api/event'
import {
  ChevronDown,
  CloudDownload,
  FileUp,
  FolderOpen,
  Inbox,
  Link,
  Plus,
  RotateCcw,
  ScrollText,
  Settings,
  Upload,
  X
} from 'lucide-react'

import type { BackupImportDialogSource } from '@renderer/components/backup/backup-import-dialog'
import { getAccountWarning } from '@renderer/components/account/account-warning'
import { ThemeToggleButton } from '@renderer/components/theme/theme-toggle-button'
import { GlobalStatus, type GlobalStatusItem } from '@renderer/components/global-status'
import { formatNetworkDuration, formatNetworkRequestName, getNetworkRequestDisplay, useNetworkActivity } from '@renderer/components/network-activity-status'
import { Button } from '@renderer/components/ui/button'
import { Popover, PopoverAnchor, PopoverClose, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from '@renderer/components/ui/popover'
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

type BackgroundSyncResult = { accountId: number; ok: boolean; skipped: boolean; at?: number }
type ActivityLogTone = 'success' | 'warning' | 'danger' | 'info'
type ActivityLogLine = { key: string; at: number; tone: ActivityLogTone; account: string; action: string; duration?: string }
type AppActivity = { text: string; severity?: 'warning' | 'danger' }

const logTextTone: Record<ActivityLogTone, string> = {
  success: 'text-emerald-700 dark:text-emerald-300',
  warning: 'text-amber-700 dark:text-amber-300',
  danger: 'text-destructive dark:text-rose-300',
  info: 'text-info'
}

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
  onOpenSettings
}: {
  platform?: SystemInfo['platform'] | null
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
          <SettingsButton label={t('common.settings')} onClick={onOpenSettings} />
          <ThemeToggleButton />
        </div>
      </TooltipProvider>
    </header>
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
          variant="outline"
          size="icon-sm"
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
  loadingPhase,
  accounts,
  systemInfo,
  settings,
  accountCount,
  messageCount,
  syncNotice,
  error,
  updateStatus,
  onOpenAccountWarning,
  onOpenVersion,
  onInstallUpdate
}: {
  loading: boolean
  loadingPhase: 'initializing' | 'database' | 'accounts'
  accounts: Account[]
  systemInfo: SystemInfo | null
  settings: AppSettings | null
  accountCount: number
  messageCount: number
  syncNotice: SyncNotice
  error?: string | null
  updateStatus: AppUpdateStatus | null
  onOpenAccountWarning: (accountId: string) => void
  onOpenVersion: () => void
  onInstallUpdate: () => void
}): React.JSX.Element {
  const { locale, t } = useI18n()
  const network = useNetworkActivity()
  const [memoryBytes, setMemoryBytes] = React.useState<number | null>(null)
  const [databaseBytes, setDatabaseBytes] = React.useState<number | null>(null)
  const [showSyncResult, setShowSyncResult] = React.useState(false)
  const [backgroundResult, setBackgroundResult] = React.useState<BackgroundSyncResult | null>(null)
  const [activityOpen, setActivityOpen] = React.useState(false)
  const [activityTooltipOpen, setActivityTooltipOpen] = React.useState(false)
  const logViewportRef = React.useRef<HTMLDivElement>(null)
  const animatedLogKeysRef = React.useRef<Set<string>>(new Set())

  React.useEffect(() => {
    let active = true
    const readMemory = () => {
      void window.api.system.memory()
        .then((bytes) => { if (active) setMemoryBytes(bytes) })
        .catch(() => { if (active) setMemoryBytes(null) })
      void window.api.system.databaseSize()
        .then((bytes) => { if (active) setDatabaseBytes(bytes) })
        .catch(() => { if (active) setDatabaseBytes(null) })
    }
    readMemory()
    const timer = window.setInterval(readMemory, 15_000)
    return () => { active = false; window.clearInterval(timer) }
  }, [])

  React.useEffect(() => {
    if (syncNotice.state !== 'success' && syncNotice.state !== 'error') {
      setShowSyncResult(false)
      return
    }
    setShowSyncResult(true)
    const timer = window.setTimeout(() => setShowSyncResult(false), syncNotice.state === 'error' ? 12_000 : 6_000)
    return () => window.clearTimeout(timer)
  }, [syncNotice.state, syncNotice.finishedAt])

  React.useEffect(() => {
    let active = true
    let stop: (() => void) | undefined
    void listen<BackgroundSyncResult>('sync/backgroundResult', (event) => {
      if (!event.payload.skipped) {
        setBackgroundResult((current) => current && !current.ok && event.payload.ok ? current : { ...event.payload, at: Date.now() })
      }
    }).then((unlisten) => {
      if (active) stop = unlisten
      else unlisten()
    }).catch(() => undefined)
    return () => { active = false; stop?.() }
  }, [])

  React.useEffect(() => {
    if (!backgroundResult) return
    const timer = window.setTimeout(() => setBackgroundResult(null), backgroundResult.ok ? 6_000 : 12_000)
    return () => window.clearTimeout(timer)
  }, [backgroundResult])

  const syncText = formatSyncNotice(syncNotice, t)
  const updateText = formatUpdateStatus(updateStatus, t)
  const hasUpdate = hasAvailableUpdate(updateStatus)
  const accountIssues = accounts.flatMap<{ account: Account; title: string }>((account) => {
    const warning = getAccountWarning(account, t)
    if (warning) return [{ account, title: `${warning.title}：${warning.message}` }]
    return []
  })
  const showingManualSync = syncNotice.state === 'running' || showSyncResult
  const syncIssueAccount = showingManualSync
    ? accountIssues.find(({ account }) => [account.id, account.address, account.name].includes(syncNotice.label))?.account
      ?? accountIssues[0]?.account
    : backgroundResult && !backgroundResult.ok
      ? accounts.find((account) => account.accountId === backgroundResult.accountId)
      : undefined
  const syncStatusText = showingManualSync
    ? syncText
    : backgroundResult
      ? t(backgroundResult.ok ? 'status.backgroundSyncSuccess' : 'status.backgroundSyncFailed', {
        account: accounts.find((account) => account.accountId === backgroundResult.accountId)?.address ?? String(backgroundResult.accountId)
      })
      : ''
  const syncHasError = showingManualSync ? syncNotice.state === 'error' : backgroundResult !== null && !backgroundResult.ok
  const statuses: GlobalStatusItem[] = [{
    key: 'local',
    label: t('status.categoryLocal'),
    text: systemInfo ? t('status.localReady') : error || (loading ? t('status.localLoading') : t('status.localUnavailable')),
    severity: !systemInfo && error ? 'danger' : !systemInfo && !loading ? 'warning' : 'normal',
    active: !systemInfo && loading
  }]
  statuses.push({
    key: 'database',
    label: t('status.categoryDatabase'),
    text: databaseBytes === null ? '—' : formatDatabaseSize(databaseBytes),
    title: systemInfo?.databasePath ? t('status.openDatabaseFolder', { name: systemInfo.databasePath }) : undefined,
    severity: 'normal',
    onSelect: systemInfo?.databasePath
      ? () => { void window.api.system.openDatabaseDirectory().catch(() => toast.error(t('status.openDatabaseFolderFailed'))) }
      : undefined
  })
  statuses.push({
    key: 'accounts',
    label: t('status.categoryAccounts'),
    text: accountCount === 0
      ? t('status.noAccounts')
      : t('status.accountsHealthy', { healthy: accountCount - accountIssues.length, total: accountCount }),
    title: accountIssues.length
      ? accountIssues.map(({ account, title }) => `${account.address}: ${title}`).join('\n')
      : undefined,
    severity: accountCount > 0 && accountIssues.length > accountCount / 2 ? 'danger' : accountIssues.length ? 'warning' : 'normal',
    onSelect: accountIssues.length ? () => onOpenAccountWarning(accountIssues[0].account.id) : undefined
  })
  statuses.push({
    key: 'memory',
    label: t('status.categoryMemory'),
    text: memoryBytes === null ? '—' : `${Math.round(memoryBytes / 1_000_000)} MB`,
    title: t('status.memoryMainProcess'),
    severity: 'normal'
  })
  const syncRequests = network.requests.filter((request) => request.kind === 'sync')
  const foregroundRequest = network.requests.find((request) => ['send', 'oauth', 'body', 'ai', 'folders'].includes(request.kind))
  let activity: AppActivity | undefined
  if (loading) {
    activity = {
      text: loadingPhase === 'database' ? t('status.databaseLoading')
        : loadingPhase === 'accounts' ? t('status.accountsLoading')
          : t('status.appInitializing')
    }
  } else if (syncNotice.state === 'running') {
    activity = {
      text: syncNotice.activity
        ? t('status.syncingActivity', { account: syncNotice.activity.account, stage: formatSyncStep(syncNotice.activity.stage, t) })
        : syncText
    }
  } else if (showSyncResult && syncNotice.state === 'error') {
    activity = { text: syncText, severity: 'danger' }
  } else if (backgroundResult && !backgroundResult.ok) {
    const account = accounts.find((item) => item.accountId === backgroundResult.accountId)
    activity = { text: t('status.backgroundSyncFailed', { account: account?.address ?? String(backgroundResult.accountId) }), severity: 'danger' }
  } else if (error) {
    activity = { text: error, severity: 'danger' }
  } else if (showSyncResult && syncNotice.state === 'success') {
    activity = { text: syncText }
  } else if (syncRequests.length > 1) {
    activity = { text: t('status.syncingAccounts', { count: syncRequests.length }) }
  } else if (syncRequests.length === 1) {
    const account = accounts.find((item) => item.accountId === syncRequests[0].accountId)
    activity = { text: account ? t('status.syncingAccount', { account: account.address }) : t('sync.running') }
  } else if (backgroundResult) {
    const account = accounts.find((item) => item.accountId === backgroundResult.accountId)
    activity = { text: t('status.backgroundSyncSuccess', { account: account?.address ?? String(backgroundResult.accountId) }) }
  } else if (foregroundRequest) {
    activity = { text: formatNetworkRequestName(foregroundRequest, accounts, t) }
  } else if (updateStatus?.state === 'downloading' || updateStatus?.state === 'installing') {
    activity = { text: updateText ?? t('status.updateChecking') }
  } else if (updateStatus?.state === 'error' && updateText) {
    activity = { text: updateText, severity: 'danger' }
  }
  React.useEffect(() => {
    if (error && syncNotice.state !== 'running' && syncNotice.state !== 'error') toast.error(error, { duration: 8000 })
  }, [error, syncNotice.state])
  const versionLabel = systemInfo?.appVersion ? `v${systemInfo.appVersion}` : '...'
  const versionTitle =
    hasUpdate && updateStatus?.latestVersion
      ? t('status.openHomepageForUpdate', { version: updateStatus.latestVersion })
      : hasUpdate
        ? t('status.openHomepageForUpdateGeneric')
        : t('status.openRepository')
  const logLines: ActivityLogLine[] = [
    ...network.requests.map((request) => ({
      key: `running-${request.id}`,
      at: request.startedAt,
      tone: 'info' as const,
      ...getNetworkRequestDisplay(request, accounts, t),
      duration: formatNetworkDuration(network.now - request.startedAt, locale)
    })),
    ...network.recent.map((request) => ({
      key: `recent-${request.id}`,
      at: request.finishedAt,
      tone: 'info' as const,
      ...getNetworkRequestDisplay(request, accounts, t),
      duration: formatNetworkDuration(request.durationMs, locale)
    })),
    ...(syncNotice.steps ?? []).map((step, index) => ({
      key: `step-${index}-${step.at}`,
      at: step.at,
      tone: (step.stage === 'failed' ? 'danger' : step.stage === 'skipped' ? 'warning' : step.stage === 'complete' ? 'success' : 'info') as ActivityLogTone,
      account: step.account,
      action: `${formatSyncStep(step.stage, t)}${step.folder ? ` · ${step.folder}` : ''}`
    }))
  ]
  if (syncStatusText) logLines.push({
    key: 'sync-status',
    at: showingManualSync
      ? syncNotice.finishedAt?.getTime() ?? syncNotice.startedAt?.getTime() ?? network.now
      : backgroundResult?.at ?? network.now,
    tone: syncHasError ? 'danger' : syncNotice.state === 'running' ? 'info' : 'success',
    account: showingManualSync
      ? syncNotice.activity?.account ?? (syncNotice.label === 'all' ? '' : syncNotice.label)
      : accounts.find((account) => account.accountId === backgroundResult?.accountId)?.address ?? String(backgroundResult?.accountId ?? ''),
    action: syncHasError ? t('sync.error') : syncNotice.state === 'running' ? t('sync.running') : t('sync.success')
  })
  if (updateText && updateStatus) logLines.push({
    key: 'update-status',
    at: Date.parse(updateStatus.updatedAt) || network.now,
    tone: updateStatus.state === 'error' ? 'danger' : updateStatus.state === 'cancelled' ? 'warning' : updateStatus.state === 'downloaded' || updateStatus.state === 'not_available' ? 'success' : 'info',
    account: '',
    action: updateText
  })
  if (network.connection === 'error') logLines.push({
    key: 'network-unavailable',
    at: network.now,
    tone: 'warning',
    account: '',
    action: t('status.requestsUnavailable')
  })
  logLines.sort((left, right) => left.at - right.at)
  const logEventKey = logLines.map((line) => line.key).join('|')
  const hasActivityActions = (syncHasError && !!syncIssueAccount) || hasUpdate

  React.useEffect(() => {
    if (activityOpen && logViewportRef.current) {
      logViewportRef.current.scrollTop = logViewportRef.current.scrollHeight
    }
  }, [activityOpen])

  React.useEffect(() => {
    const viewport = logViewportRef.current
    if (!activityOpen || !viewport || window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return
    const tween = gsap.fromTo(viewport, { autoAlpha: 0, y: 5 }, {
      autoAlpha: 1, y: 0, duration: 0.2, ease: 'power2.out', clearProps: 'opacity,visibility,transform'
    })
    return () => { tween.kill(); gsap.set(viewport, { clearProps: 'opacity,visibility,transform' }) }
  }, [activityOpen])

  React.useEffect(() => {
    const viewport = logViewportRef.current
    if (!activityOpen || !viewport) return
    if (viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 48) {
      viewport.scrollTop = viewport.scrollHeight
    }
  }, [activityOpen, logEventKey])

  React.useEffect(() => {
    if (!activityOpen) { animatedLogKeysRef.current.clear(); return }
    const visibleLines = logLines.slice(-40)
    const previous = animatedLogKeysRef.current
    const newKeys = visibleLines.filter((line) => !previous.has(line.key)).map((line) => line.key)
    animatedLogKeysRef.current = new Set(visibleLines.map((line) => line.key))
    if (previous.size === 0 || newKeys.length === 0 || window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return
    const nodes = Array.from(logViewportRef.current?.querySelectorAll<HTMLElement>('[data-log-key]') ?? [])
      .filter((node) => newKeys.includes(node.dataset.logKey ?? ''))
    if (nodes.length === 0) return
    const tween = gsap.fromTo(nodes, { autoAlpha: 0, y: 4 }, {
      autoAlpha: 1, y: 0, duration: 0.18, ease: 'power2.out', stagger: 0.02, clearProps: 'opacity,visibility,transform', overwrite: 'auto'
    })
    return () => { tween.kill(); gsap.set(nodes, { clearProps: 'opacity,visibility,transform' }) }
  }, [activityOpen, logEventKey])

  return (
    <>
    <footer className="app-drag-region native-statusbar flex h-7 shrink-0 items-center justify-between gap-2 border-t px-2 text-[11px] text-muted-foreground">
      <GlobalStatus items={statuses} />
      <div className="app-no-drag ml-auto flex min-w-0 items-center justify-end gap-1.5 overflow-hidden">
        <Popover open={activityOpen} onOpenChange={(open) => { setActivityOpen(open); if (open) setActivityTooltipOpen(false) }}>
          <TooltipProvider>
            <Tooltip open={activityTooltipOpen && !activityOpen} onOpenChange={(open) => setActivityTooltipOpen(open && !activityOpen)}>
              <TooltipTrigger asChild><PopoverTrigger asChild>
                <Button variant="ghost" size="xs" className={cn('h-5 max-w-[min(28vw,16rem)] gap-1 px-1 text-[11px] font-normal text-muted-foreground', activity?.severity === 'warning' && 'text-amber-700 dark:text-warning', activity?.severity === 'danger' && 'text-destructive')} aria-label={`${t('status.activityDetails')}：${activity?.text ?? t('status.activityIdle')}`}>
                  <ScrollText className="size-3.5" aria-hidden="true" />
                  <span className="min-w-0 truncate">{activity?.text ?? t('status.activityIdle')}</span>
                </Button>
              </PopoverTrigger></TooltipTrigger>
              <TooltipContent side="top" align="end" sideOffset={6} showArrow={false} className="max-w-[min(24rem,calc(100vw-1rem))] break-words">
                {activity?.text ?? t('status.activityIdle')}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <PopoverContent side="top" align="end" sideOffset={6} aria-label={t('status.activityDetails')} className="w-[min(30rem,calc(100vw-1rem))] gap-0 overflow-hidden rounded-xl border border-border bg-popover p-0 text-xs shadow-xl ring-0">
            <PopoverHeader className="flex-row items-center justify-between gap-2 border-b px-2.5 py-1.5">
              <PopoverTitle className="text-xs font-semibold">{t('status.activityDetails')}</PopoverTitle>
              <div className="flex items-center gap-1">
                <PopoverClose asChild><Button variant="ghost" size="xs" className="h-5 px-1.5 text-muted-foreground" onClick={() => { void window.api.system.revealLogs().catch(() => toast.error(t('status.openLogsFailed'))) }}><FolderOpen data-icon="inline-start" />{t('settings.about.openLogs')}</Button></PopoverClose>
                <PopoverClose asChild><Button variant="ghost" size="icon-xs" className="size-5" aria-label={t('common.close')}><X className="size-3.5" /></Button></PopoverClose>
              </div>
            </PopoverHeader>
            <div ref={logViewportRef} role="log" aria-live="off" className="max-h-[min(15rem,40vh)] overflow-y-auto bg-muted/50 px-4 py-2 font-mono text-[11px] leading-4 text-foreground dark:bg-zinc-950 dark:text-zinc-200">
              {logLines.length === 0
                ? <div className="text-muted-foreground">{t('status.activityIdleDescription')}</div>
                : logLines.slice(-40).map((line) => <div key={line.key} data-log-key={line.key} className={cn('grid min-w-0 grid-cols-[4rem_minmax(0,1fr)_4.5rem_3rem] items-center gap-x-1 whitespace-nowrap', logTextTone[line.tone])}>
                  <time dateTime={new Date(line.at).toISOString()} className="shrink-0 tabular-nums">{new Date(line.at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</time>
                  {line.account
                    ? <><span className="min-w-0 truncate">{line.account}</span><span className="min-w-0 truncate">{line.action}</span></>
                    : <span className="col-span-2 min-w-0 truncate">{line.action}</span>}
                  <span className="text-right tabular-nums">{line.duration ?? ''}</span>
                </div>)}
            </div>
            {hasActivityActions && <div className="flex flex-wrap justify-end gap-1.5 border-t px-2 py-1.5">
              {syncHasError && syncIssueAccount && <PopoverClose asChild><Button variant="outline" size="xs" onClick={() => onOpenAccountWarning(syncIssueAccount.id)}>{t('status.viewAccountWarning')}</Button></PopoverClose>}
              {updateStatus?.state === 'downloaded' && <Button size="xs" onClick={onInstallUpdate}><RotateCcw data-icon="inline-start" />{t('status.updateRestart')}</Button>}
              {hasUpdate && updateStatus?.state !== 'downloaded' && <Button size="xs" onClick={onOpenVersion}>{t('status.openUpdatePage')}</Button>}
            </div>}
          </PopoverContent>
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
          <PopoverAnchor asChild>
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
          </PopoverAnchor>
        </Popover>
      </div>
    </footer>
    </>
  )
}

function formatDatabaseSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
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

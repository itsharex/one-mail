import * as React from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { queryClient } from '@renderer/lib/query-client'
import { type BackupImportDialogSource } from '@renderer/components/backup/backup-import-dialog'
import { Account } from '@renderer/components/mail/types'
import { getAccountWarning } from '@renderer/components/account/account-warning'
import { ResizablePrimitive } from '@renderer/components/ui/resizable'
import { AiSettings, AppSettings, AppUpdateStatus, SystemInfo } from '@renderer/shared/types'
import {
  getAppUpdateStatus,
  loadAccounts,
  loadAiSettings,
  loadInitialData,
  loadOutboxMessages,
  onAccountCreated,
  onAppUpdateStatus,
  onMailboxChanged,
  onSyncProgress,
  syncAccount,
} from '@renderer/pages/mailbox/api'
import { normalizeLocale, useI18n } from '@renderer/lib/i18n'
import { onSystemNotificationOpen } from '@renderer/lib/system-notifications'
import { OutboxMessage } from '@renderer/pages/mailbox/api'
import { getErrorMessage, getFallbackAccount } from '../mailbox-utils'
import { useMailComposer } from '../use-mail-composer'
import { useSyncFeedback } from '../use-sync-feedback'
export type DialogKind = 'edit' | 'delete' | null

export function useMailboxWorkspaceData() {
  const { setLocale, t } = useI18n()
  const [accounts, setAccounts] = React.useState<Account[]>([])
  const [settings, setSettings] = React.useState<AppSettings | null>(null)
  const [aiSettings, setAiSettings] = React.useState<AiSettings | null>(null)
  const [aiSessionEpoch, setAiSessionEpoch] = React.useState(0)
  const [systemInfo, setSystemInfo] = React.useState<SystemInfo | null>(null)
  const [updateStatus, setUpdateStatus] = React.useState<AppUpdateStatus | null>(null)
  const [selectedAccountId, setSelectedAccountId] = React.useState('all')
  const [openMessageId, setOpenMessageId] = React.useState<number | null>(null)
  const [dialogKind, setDialogKind] = React.useState<DialogKind>(null)
  const [backupImportDialogOpen, setBackupImportDialogOpen] = React.useState(false)
  const [backupImportSource, setBackupImportSource] =
    React.useState<BackupImportDialogSource>('sql')
  const [backupImportBusy, setBackupImportBusy] = React.useState(false)
  const [dialogAccountId, setDialogAccountId] = React.useState<string | null>(null)
  const [warningAccountId, setWarningAccountId] = React.useState<string | null>(null)
  const [outboxOpen, setOutboxOpen] = React.useState(false)
  const [outboxMessages, setOutboxMessages] = React.useState<OutboxMessage[]>([])
  const [outboxPending, setOutboxPending] = React.useState(false)
  const { syncingAccountIds, syncNotice, startSyncing, finishSyncing, setNotice, clearSyncing } =
    useSyncFeedback()
  const [loading, setLoading] = React.useState(true)
  const [loadingPhase, setLoadingPhase] = React.useState<'initializing' | 'database' | 'accounts'>('initializing')
  const [error, setError] = React.useState<string | null>(null)
  const conversationLayout = ResizablePrimitive.useDefaultLayout({
    id: 'onemail-conversation-layout-v1',
    panelIds: ['accounts', 'conversations']
  })

  const dialogAccount =
    accounts.find((account) => account.id === dialogAccountId) ??
    accounts.find((account) => account.id === selectedAccountId)
  const warningAccount =
    accounts.find((account) => account.id === warningAccountId) ??
    (warningAccountId ? null : undefined)
  React.useEffect(() => {
    if (warningAccountId && warningAccount && !getAccountWarning(warningAccount, t)) {
      setWarningAccountId(null)
    }
  }, [warningAccountId, warningAccount, t])
  const realAccounts = accounts.filter((account) => Boolean(account.accountId))
  const hasAccounts = realAccounts.length > 0
  const selectedAccount =
    accounts.find((account) => account.id === selectedAccountId) ??
    accounts[0] ??
    getFallbackAccount()
  const showNoAccounts = !loading && !hasAccounts
  const {
    composerOpen,
    composerDraft,
    composerPending,
    openComposer,
    openOutboxDraft,
    closeComposer,
    sendComposerDraft,
    saveComposerDraft,
    discardComposerDraft
  } = useMailComposer({
    accounts,
    selectedAccount,
    setError
  })

  const refreshAccounts = React.useCallback(async () => {
    const nextAccounts = await loadAccounts()
    setAccounts(nextAccounts)
  }, [])

  const refreshOutbox = React.useCallback(async (): Promise<void> => {
    const messages = await loadOutboxMessages()
    setOutboxMessages(messages)
  }, [])

  const handleRefreshOutbox = React.useCallback(() => {
    void refreshOutbox().catch((refreshError) => {
      setError(getErrorMessage(refreshError, t('mailbox.loadOutboxError')))
    })
  }, [refreshOutbox, t])

  const refreshMailbox = React.useCallback(async (): Promise<void> => {
    await Promise.all([
      refreshAccounts(),
      queryClient.invalidateQueries({ queryKey: ['conversations'] }, { cancelRefetch: false })
    ])
  }, [refreshAccounts])

  const reloadInitialData = React.useCallback(async () => {
    const [data, nextAiSettings] = await Promise.all([
      loadInitialData(),
      loadAiSettings().catch(() => null)
    ])
    setAccounts(data.accounts)
    setSettings(data.settings)
    setAiSettings(nextAiSettings)
    setLocale(normalizeLocale(data.settings.locale))
    setSystemInfo(data.systemInfo)
    setSelectedAccountId(data.selectedAccountId)
  }, [setLocale])

  const reloadAfterBackupImport = React.useCallback(async () => {
    await reloadInitialData()
    setAiSessionEpoch((current) => current + 1)
  }, [reloadInitialData])

  React.useEffect(() => {
    let cancelled = false

    async function load(): Promise<void> {
      try {
        setLoading(true)
        setError(null)
        const [data, nextAiSettings] = await Promise.all([
          loadInitialData((phase) => { if (!cancelled) setLoadingPhase(phase) }),
          loadAiSettings().catch(() => null)
        ])
        if (cancelled) return
        setAccounts(data.accounts)
        setSettings(data.settings)
        setAiSettings(nextAiSettings)
        setLocale(normalizeLocale(data.settings.locale))
        setSystemInfo(data.systemInfo)
        setSelectedAccountId(data.selectedAccountId)
      } catch (loadError) {
        if (!cancelled) {
          setError(getErrorMessage(loadError, t('mailbox.loadDataError')))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [setLocale, t])

  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = () => {
      if (timer) return
      timer = setTimeout(() => {
        timer = undefined
        void refreshMailbox().catch((refreshError) => {
          setError(getErrorMessage(refreshError, t('mailbox.refreshMailError')))
        })
      }, 250)
    }
    const offMailbox = onMailboxChanged(refresh)
    const offSent = window.api.compose.onSent(refresh)
    return () => {
      offMailbox(); offSent()
      if (timer) clearTimeout(timer)
    }
  }, [refreshMailbox, t])

  React.useEffect(() => onSyncProgress((progress) => {
    if (progress.completed !== undefined) clearSyncing(String(progress.accountId))
    setNotice((current) => current.state === 'running' ? {
      ...current,
      progress: progress.completed !== undefined && progress.total !== undefined
        ? { completed: progress.completed, total: progress.total }
        : current.progress,
      activity: progress.stage || progress.completed !== undefined ? {
        account: accounts.find((account) => account.accountId === progress.accountId)?.address ?? String(progress.accountId),
        stage: progress.stage ?? (progress.skipped ? 'skipped' : progress.ok ? 'complete' : 'failed'),
        folder: progress.folder
      } : current.activity,
      steps: progress.stage || progress.completed !== undefined ? [...(current.steps ?? []).slice(-19), {
        account: accounts.find((account) => account.accountId === progress.accountId)?.address ?? String(progress.accountId),
        stage: progress.stage ?? (progress.skipped ? 'skipped' : progress.ok ? 'complete' : 'failed'),
        folder: progress.folder,
        at: Date.now()
      }] : current.steps,
      message: progress.completed !== undefined && progress.total !== undefined
        ? t('mailbox.syncProgress', { completed: progress.completed, total: progress.total })
        : current.message
    } : current)
  }), [accounts, clearSyncing, setNotice, t])

  React.useEffect(() => onSystemNotificationOpen((messageId) => {
    setSelectedAccountId('all')
    setOpenMessageId(messageId)
  }), [])

  React.useEffect(() => {
    let active = true
    let stop: (() => void) | undefined
    const openPendingCompose = () => {
      if (loading) return
      void invoke<boolean>('tray_take_compose_request')
        .then((pending) => { if (active && pending && !composerOpen) void openComposer('new') })
        .catch((reason) => console.warn('Failed to read tray compose action.', reason))
    }
    void listen('tray/compose', openPendingCompose)
      .then((unlisten) => {
        if (active) { stop = unlisten; openPendingCompose() }
        else unlisten()
      })
      .catch((reason) => console.warn('Failed to listen for tray compose action.', reason))
    return () => { active = false; stop?.() }
  }, [composerOpen, loading, openComposer])

  React.useEffect(() => {
    let cancelled = false

    void getAppUpdateStatus()
      .then((status) => {
        if (!cancelled) setUpdateStatus(status)
      })
      .catch(() => undefined)

    const off = onAppUpdateStatus((status) => {
      setUpdateStatus(status)
    })

    return () => {
      cancelled = true
      off()
    }
  }, [])

  React.useEffect(() => {
    let active = true
    const stops: Array<() => void> = []
    void Promise.all([
      listen<AppSettings>('settings/changed', (event) => {
        setSettings(event.payload)
        setLocale(normalizeLocale(event.payload.locale))
      }),
      listen('ai/settingsChanged', () => {
        void loadAiSettings().then((next) => { if (active) setAiSettings(next) })
          .catch((reason) => console.warn('Failed to refresh AI settings.', reason))
      }),
      listen('settings/backupImported', () => {
        void reloadAfterBackupImport().catch((reason) =>
          setError(getErrorMessage(reason, t('mailbox.loadDataError')))
        )
      })
    ]).then((listeners) => {
      if (active) stops.push(...listeners)
      else listeners.forEach((stop) => stop())
    }).catch((reason) => console.warn('Failed to subscribe to settings updates.', reason))
    return () => { active = false; stops.forEach((stop) => stop()) }
  }, [reloadAfterBackupImport, setLocale, t])

  const syncCreatedAccountInBackground = React.useCallback(
    (accountId: number, accountEmail: string, startedAt: Date): void => {
      const accountKey = String(accountId)
      startSyncing(accountKey, {
        label: accountEmail,
        startedAt,
        message: t('mailbox.accountSavedSyncing', { email: accountEmail })
      })

      void syncAccount(accountId, 'initial')
        .then(async (syncResult) => {
          if (syncResult.ok === false) {
            throw new Error(syncResult.error || t('mailbox.syncAccountError'))
          }
          await refreshMailbox()
          finishSyncing(accountKey, 'success', {
            label: accountEmail,
            startedAt,
            message: t('mailbox.initialSyncComplete', {
              email: accountEmail,
              inserted: syncResult.insertedCount ?? 0,
              scanned: syncResult.scannedCount ?? 0
            })
          })
        })
        .catch(async (syncError) => {
          const message = getErrorMessage(syncError, t('mailbox.syncAccountError'))
          try {
            await refreshAccounts()
          } catch {
            setAccounts((current) => current.map((account) => account.accountId === accountId ? {
              ...account,
              status: account.connectionStatus === 'reauthorize' ? 'auth_error' : 'sync_error',
              lastError: message
            } : account))
          }
          setWarningAccountId(accountKey)
          finishSyncing(accountKey, 'error', {
            label: accountEmail,
            startedAt,
            message: t('mailbox.backgroundSyncFailed', { email: accountEmail, message })
          })
        })
    },
    [
      finishSyncing,
      refreshAccounts,
      refreshMailbox,
      startSyncing,
      t
    ]
  )

  React.useEffect(() => {
    return onAccountCreated((event) => {
      const startedAt = new Date()
      const nextSelectedAccountId = String(event.account.accountId)

      setError(null)
      void loadAccounts()
        .then(async (nextAccounts) => {
          setAccounts(nextAccounts)
          setSelectedAccountId(nextSelectedAccountId)
          await queryClient.invalidateQueries({ queryKey: ['conversations'] })
        })
        .catch((refreshError) => {
          setError(getErrorMessage(refreshError, t('mailbox.refreshAccountError')))
        })

      if (event.requestedSync) {
        syncCreatedAccountInBackground(event.account.accountId, event.account.email, startedAt)
      } else {
        setNotice({
          state: 'success',
          label: event.account.email,
          startedAt,
          finishedAt: new Date(),
          message: t('mailbox.accountSaved', { email: event.account.email })
        })
      }
    })
  }, [setNotice, syncCreatedAccountInBackground, t])

  return {
    accounts,
    aiSessionEpoch,
    aiSettings,
    backupImportBusy,
    backupImportDialogOpen,
    backupImportSource,
    clearSyncing,
    closeComposer,
    composerDraft,
    composerOpen,
    composerPending,
    conversationLayout,
    dialogAccount,
    dialogAccountId,
    dialogKind,
    discardComposerDraft,
    error,
    finishSyncing,
    handleRefreshOutbox,
    hasAccounts,
    loading,
    loadingPhase,
    openComposer,
    openMessageId,
    openOutboxDraft,
    outboxMessages,
    outboxOpen,
    outboxPending,
    realAccounts,
    refreshAccounts,
    refreshMailbox,
    refreshOutbox,
    reloadAfterBackupImport,
    reloadInitialData,
    saveComposerDraft,
    selectedAccount,
    selectedAccountId,
    sendComposerDraft,
    setAccounts,
    setAiSessionEpoch,
    setAiSettings,
    setBackupImportBusy,
    setBackupImportDialogOpen,
    setBackupImportSource,
    setDialogAccountId,
    setDialogKind,
    setError,
    setLoading,
    setLocale,
    setNotice,
    setOutboxMessages,
    setOutboxOpen,
    setOutboxPending,
    setOpenMessageId,
    setSelectedAccountId,
    setSettings,
    setSystemInfo,
    setUpdateStatus,
    setWarningAccountId,
    settings,
    showNoAccounts,
    startSyncing,
    syncCreatedAccountInBackground,
    syncNotice,
    syncingAccountIds,
    systemInfo,
    t,
    updateStatus,
    warningAccount,
    warningAccountId,
  }
}

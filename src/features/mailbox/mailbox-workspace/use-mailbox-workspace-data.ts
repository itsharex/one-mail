import * as React from 'react'
import { queryClient } from '@renderer/lib/query-client'
import { type BackupImportDialogSource } from '@renderer/components/backup/backup-import-dialog'
import { Account } from '@renderer/components/mail/types'
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
  onNewMail,
  syncAccount,
} from '@renderer/pages/mailbox/api'
import { normalizeLocale, useI18n } from '@renderer/lib/i18n'
import {
  onSystemNotificationOpen,
  showNewMailSystemNotification,
  showSyncCompleteSystemNotification,
} from '@renderer/lib/system-notifications'
import { normalizeProviderKey } from '@renderer/shared/provider-metadata'
import { OutboxMessage } from '@renderer/pages/mailbox/api'
import { toast } from 'sonner'
import {
  createOutlookHelpAccount,
  getErrorMessage,
  getFallbackAccount,
  shouldShowOutlookImapHelp,
} from '../mailbox-utils'
import { useMailComposer } from '../use-mail-composer'
import { useSyncFeedback } from '../use-sync-feedback'
export type DialogKind = 'edit' | 'delete' | 'settings' | null
export type SyncAllFailure = { accountId: number; error: string }

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
  const [settingsInitialSection, setSettingsInitialSection] = React.useState<'general' | 'about'>(
    'general'
  )
  const [dialogAccountId, setDialogAccountId] = React.useState<string | null>(null)
  const [warningAccountId, setWarningAccountId] = React.useState<string | null>(null)
  const [outboxOpen, setOutboxOpen] = React.useState(false)
  const [outboxMessages, setOutboxMessages] = React.useState<OutboxMessage[]>([])
  const [outboxPending, setOutboxPending] = React.useState(false)
  const [outlookImapHelpAccount, setOutlookImapHelpAccount] = React.useState<Account | null>(null)
  const { syncingAccountIds, syncNotice, startSyncing, finishSyncing, setNotice, clearSyncing } =
    useSyncFeedback()
  const lastNotifiedSync = React.useRef<Date | undefined>(undefined)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [syncFailures, setSyncFailures] = React.useState<SyncAllFailure[]>([])
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
          loadInitialData(),
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
    clearSyncing(String(progress.accountId))
    if (!progress.ok) {
      setSyncFailures((current) => [
        ...current.filter((failure) => failure.accountId !== progress.accountId),
        { accountId: progress.accountId, error: progress.error?.trim() || t('sync.error') }
      ])
    }
    setNotice((current) => current.state === 'running' ? {
      ...current,
      message: t('mailbox.syncProgress', { completed: progress.completed, total: progress.total })
    } : current)
  }), [clearSyncing, setNotice, t])

  React.useEffect(() => {
    return onNewMail((notification) => {
      const platform = document.documentElement.dataset.platform
      const account = accounts.find((item) => item.accountId === notification.accountId)
      const provider = normalizeProviderKey(account?.providerKey === 'custom'
        ? notification.accountEmail?.split('@')[1]
        : account?.providerKey ?? notification.accountEmail?.split('@')[1])
      void showNewMailSystemNotification(
        notification,
        {
          title: t('notification.newMail.title'),
          countTitle: t('notification.newMail.countTitle', {
            count: notification.messageCount
          }),
          noSubject: t('common.noSubject'),
          unknownSender: t('common.unknownSender')
        },
        platform === 'macos' || platform === 'windows' ? platform : 'linux',
        provider
      ).catch((notificationError) => {
        console.warn('Failed to show the new-mail system notification.', notificationError)
      })
    })
  }, [accounts, t])

  React.useEffect(() => onSystemNotificationOpen((messageId) => {
    setSelectedAccountId('all')
    setOpenMessageId(messageId)
  }), [])

  React.useEffect(() => {
    if (syncNotice.state !== 'success' || !syncNotice.finishedAt) return
    if (lastNotifiedSync.current === syncNotice.finishedAt) return
    lastNotifiedSync.current = syncNotice.finishedAt
    void showSyncCompleteSystemNotification(
      t('sync.success'),
      `${syncNotice.label} · ${t('status.syncDuration', { seconds: Math.max(1, Math.round((syncNotice.finishedAt.getTime() - (syncNotice.startedAt?.getTime() ?? syncNotice.finishedAt.getTime())) / 1000)) })}`
    ).catch((notificationError) => {
      console.warn('Failed to show the sync completion notification.', notificationError)
      toast.error(t('notification.systemDeliveryFailed'))
    })
  }, [syncNotice, t])

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
          await refreshMailbox()
          finishSyncing(accountKey, 'success', {
            label: accountEmail,
            startedAt,
            message: t('mailbox.initialSyncComplete', {
              email: accountEmail,
              inserted: syncResult.insertedCount,
              scanned: syncResult.scannedCount
            })
          })
        })
        .catch((syncError) => {
          const message = getErrorMessage(syncError, t('mailbox.syncAccountError'))
          const account = accounts.find((item) => item.accountId === accountId)
          if (shouldShowOutlookImapHelp(message, account)) {
            setOutlookImapHelpAccount(account ?? createOutlookHelpAccount(accountId, accountEmail))
          }
          setError(message)
          finishSyncing(accountKey, 'error', {
            label: accountEmail,
            startedAt,
            message: t('mailbox.backgroundSyncFailed', { email: accountEmail, message })
          })
        })
    },
    [
      accounts,
      finishSyncing,
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
    lastNotifiedSync,
    loading,
    openComposer,
    openMessageId,
    openOutboxDraft,
    outboxMessages,
    outboxOpen,
    outboxPending,
    outlookImapHelpAccount,
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
    setOutlookImapHelpAccount,
    setOpenMessageId,
    setSelectedAccountId,
    setSettings,
    setSettingsInitialSection,
    setSyncFailures,
    setSystemInfo,
    setUpdateStatus,
    setWarningAccountId,
    settings,
    settingsInitialSection,
    showNoAccounts,
    startSyncing,
    syncCreatedAccountInBackground,
    syncFailures,
    syncNotice,
    syncingAccountIds,
    systemInfo,
    t,
    updateStatus,
    warningAccount,
    warningAccountId,
  }
}

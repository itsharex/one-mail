import * as React from 'react'
import { queryClient } from '@renderer/lib/query-client'
import { ConversationWorkspace } from '@renderer/components/conversations/conversation-workspace'
import { AccountList } from '@renderer/components/account/account-list'
import { AiAssistant } from '@renderer/components/ai/ai-assistant'
import { AccountWarningDialog } from '@renderer/components/account/account-warning-dialog'
import { EditAccountDialog } from '@renderer/components/account/edit-account-dialog'
import { OutlookImapHelpDialog } from '@renderer/components/account/outlook-imap-help-dialog'
import { RemoveAccountDialog } from '@renderer/components/account/remove-account-dialog'
import { MailComposer } from '@renderer/components/mail/mail-composer'
import { OutboxPanel } from '@renderer/components/mail/outbox-panel'
import {
  BackupImportDialog,
  type BackupImportDialogSource
} from '@renderer/components/backup/backup-import-dialog'
import type { Account } from '@renderer/components/mail/types'
import { SettingsDialog } from '@renderer/components/settings/settings-dialog'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  ResizablePrimitive
} from '@renderer/components/ui/resizable'
import type {
  AccountUpdateInput,
  AiChatInput,
  AiChatResult,
  AiSettings,
  AiSettingsInput,
  AppSettings,
  AppUpdateStatus,
  BackupImportSource,
  BackupImportResult,
  BackupSyncDownloadResult,
  SettingsUpdateInput,
  SyncAllRunResult,
  SystemInfo
} from '@renderer/shared/types'
import {
  chatWithAi,
  clearAiSettings,
  deleteDraftMessage,
  deleteOutboxMessage,
  getAppUpdateStatus,
  installAppUpdate,
  loadAccounts,
  loadAiSettings,
  loadInitialData,
  loadOutboxMessages,
  onAccountCreated,
  onAppUpdateStatus,
  onMailboxChanged,
  onSyncProgress,
  onNewMail,
  openAddAccountWindow,
  openExternalUrl,
  reauthorizeAccount,
  removeAccount,
  retryOutboxMessage,
  saveSettings,
  syncAllAccounts,
  syncAccount,
  updateAccount,
  verifyAndSaveAiSettings
} from '@renderer/pages/mailbox/api'
import { normalizeLocale, useI18n } from '@renderer/lib/i18n'
import { showNewMailSystemNotification } from '@renderer/lib/system-notifications'
import { ONEMAIL_HOMEPAGE_URL, hasAvailableUpdate } from '@renderer/lib/update-status'
import type { OutboxMessage } from '@renderer/pages/mailbox/api'
import { toast } from 'sonner'
import { NoAccountsBody, StatusBar, TitleBar } from './mailbox-chrome'
import {
  createOutlookHelpAccount,
  getErrorMessage,
  getFallbackAccount,
  getNextSelectedAccountId,
  shouldEditCredential,
  shouldShowOutlookImapHelp
} from './mailbox-utils'
import { useMailComposer } from './use-mail-composer'
import { useSyncFeedback } from './use-sync-feedback'

export type DialogKind = 'edit' | 'delete' | 'settings' | null

function formatImportResultMessage(
  result: BackupImportResult | BackupSyncDownloadResult,
  source: BackupImportSource,
  t: ReturnType<typeof useI18n>['t']
): string {
  return t(
    source === 'local'
      ? 'settings.backup.importedSummary'
      : 'settings.backup.remoteDownloadedSummary',
    {
      accounts: result.accountCount ?? 0,
      messages: result.messageCount ?? 0
    }
  )
}

type SyncAllFailure = {
  accountId: number
  error: string
}

function getSyncAllFailures(result: SyncAllRunResult): SyncAllFailure[] {
  return result.accounts
    .filter((item) => typeof item.accountId === 'number' && item.ok === false)
    .map((item) => ({ accountId: item.accountId, error: item.error?.trim() || '同步失败' }))
}

export function MailboxWorkspace(): React.JSX.Element {
  const { setLocale, t } = useI18n()
  const [accounts, setAccounts] = React.useState<Account[]>([])
  const [settings, setSettings] = React.useState<AppSettings | null>(null)
  const [aiSettings, setAiSettings] = React.useState<AiSettings | null>(null)
  const [aiSessionEpoch, setAiSessionEpoch] = React.useState(0)
  const [systemInfo, setSystemInfo] = React.useState<SystemInfo | null>(null)
  const [updateStatus, setUpdateStatus] = React.useState<AppUpdateStatus | null>(null)
  const [selectedAccountId, setSelectedAccountId] = React.useState('all')
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
      ...current, message: t('mailbox.syncProgress', { completed: progress.completed, total: progress.total })
    } : current)
  }), [clearSyncing, setNotice, t])

  React.useEffect(() => {
    return onNewMail((notification) => {
      const platform = document.documentElement.dataset.platform
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
        platform === 'macos' || platform === 'windows' ? platform : 'linux'
      ).catch((notificationError) => {
        console.warn('Failed to show the new-mail system notification.', notificationError)
      })
    })
  }, [t])

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

  function handleOpenAddAccountWindow(): void {
    void openAddAccountWindow().catch((openError) => {
      setError(getErrorMessage(openError, t('mailbox.openAddAccountWindowError')))
    })
  }

  async function handleUpdateAccount(input: AccountUpdateInput): Promise<void> {
    setError(null)
    const account = await updateAccount(input)
    if (input.password) {
      const startedAt = new Date()
      startSyncing(String(account.accountId), {
        label: account.email,
        startedAt,
        message: t('mailbox.syncingAccount', { account: account.email })
      })
      try {
        await syncAccount(account.accountId)
        finishSyncing(String(account.accountId), 'success', {
          label: account.email,
          startedAt,
          message: t('mailbox.accountSyncComplete', { account: account.email })
        })
      } catch (syncError) {
        const message = getErrorMessage(syncError, t('mailbox.syncAccountError'))
        finishSyncing(String(account.accountId), 'error', {
          label: account.email,
          startedAt,
          message: t('mailbox.accountSyncFailed', { account: account.email, message })
        })
        throw syncError
      }
    }
    await refreshMailbox()
    setDialogKind(null)
    setDialogAccountId(null)
  }

  async function handleRemoveAccount(account: Account): Promise<void> {
    if (!account.accountId) return
    setError(null)
    await removeAccount(account.accountId)
    const nextAccounts = await loadAccounts()
    const nextSelectedAccountId = getNextSelectedAccountId(
      nextAccounts,
      account.id,
      selectedAccountId
    )
    setAccounts(nextAccounts)
    if (
      selectedAccountId === account.id ||
      !nextAccounts.some((item) => item.id === selectedAccountId)
    ) {
      setSelectedAccountId(nextSelectedAccountId)
    }
    await queryClient.invalidateQueries({ queryKey: ['conversations'] })
    setDialogKind(null)
    setDialogAccountId(null)
  }

  async function handleReauthorizeAccount(account: Account): Promise<void> {
    if (!account.accountId) return

    const startedAt = new Date()
    startSyncing(account.id, {
      label: account.name,
      startedAt,
      message: t('mailbox.reauthorizing', { account: account.name })
    })
    setError(null)

    try {
      const authorizedAccount = await reauthorizeAccount(account.accountId)
      await refreshAccounts()
      finishSyncing(account.id, 'success', {
        label: account.name,
        startedAt,
        message: t('mailbox.reauthorized', { account: account.name })
      })
      await handleRefreshAccount({
        ...account,
        status: authorizedAccount.status,
        credentialState: authorizedAccount.credentialState,
        lastError: authorizedAccount.lastError
      })
    } catch (reauthorizeError) {
      const message = getErrorMessage(reauthorizeError, t('mailbox.reauthorizeError'))
      setError(message)
      finishSyncing(account.id, 'error', {
        label: account.name,
        startedAt,
        message: t('mailbox.reauthorizeFailed', { account: account.name, message })
      })
      throw reauthorizeError
    }
  }

  async function handleRefreshAccount(account: Account): Promise<void> {
    if (syncingAccountIds.has('all') || syncingAccountIds.has(account.id)) return
    setSyncFailures((current) => account.id === 'all' ? [] : current.filter((failure) => failure.accountId !== account.accountId))
    const startedAt = new Date()
    const syncMessage =
      account.id === 'all'
        ? t('mailbox.syncingAll')
        : t('mailbox.syncingAccount', { account: account.name })

    startSyncing(account.id, {
      label: account.name,
      startedAt,
      message: syncMessage
    })
    setError(null)

    try {
      let syncFailureMessage: string | null = null
      if (account.accountId) {
        await syncAccount(account.accountId)
      } else if (account.id === 'all') {
        const syncResult = await syncAllAccounts()
        const failures = getSyncAllFailures(syncResult)
        setSyncFailures(failures)
        syncFailureMessage = failures.length ? t('mailbox.syncFailureCount', { count: failures.length }) : null
      } else {
        return
      }
      await refreshMailbox()
      if (syncFailureMessage) {
        throw new Error(syncFailureMessage)
      }
      finishSyncing(account.id, 'success', {
        label: account.name,
        startedAt,
        message:
          account.id === 'all'
            ? t('mailbox.allSyncComplete')
            : t('mailbox.accountSyncComplete', { account: account.name })
      })
    } catch (refreshError) {
      const message = getErrorMessage(refreshError, t('mailbox.refreshAccountError'))
      if (shouldShowOutlookImapHelp(message, account)) {
        setOutlookImapHelpAccount(account)
      }
      if (shouldEditCredential(message)) {
        setDialogAccountId(account.id)
        setDialogKind('edit')
      }
      setError(account.accountId ? `${account.address || account.name}：${message}` : message)
      finishSyncing(account.id, 'error', {
        label: account.name,
        startedAt,
        message:
          account.id === 'all'
            ? t('mailbox.allSyncFailed', { message })
            : t('mailbox.accountSyncFailed', { account: account.name, message })
      })
    } finally {
      clearSyncing(account.id)
    }
  }

  async function handleUpdateSettings(input: SettingsUpdateInput): Promise<void> {
    const nextSettings = await saveSettings(input)
    setSettings(nextSettings)
    setLocale(normalizeLocale(nextSettings.locale))
  }

  async function handleVerifyAiSettings(input: AiSettingsInput): Promise<AiSettings> {
    const nextSettings = await verifyAndSaveAiSettings(input)
    setAiSettings(nextSettings)
    return nextSettings
  }

  async function handleClearAiSettings(): Promise<AiSettings> {
    const nextSettings = await clearAiSettings()
    setAiSettings(nextSettings)
    return nextSettings
  }

  async function handleAiChat(input: AiChatInput): Promise<AiChatResult> {
    try {
      return await chatWithAi(input)
    } catch (chatError) {
      try {
        setAiSettings(await loadAiSettings())
      } catch {
        setAiSettings(null)
      }
      throw chatError
    }
  }

  function handleImportBackup(source: BackupImportDialogSource): void {
    if (backupImportBusy) return
    setError(null)
    setBackupImportSource(source)
    setBackupImportDialogOpen(true)
  }

  async function handleBackupImported(
    result: BackupImportResult | BackupSyncDownloadResult,
    source: BackupImportSource
  ): Promise<void> {
    await reloadAfterBackupImport()
    toast.success(formatImportResultMessage(result, source, t))
  }

  async function handleSaveComposerDraft(
    input: Parameters<typeof saveComposerDraft>[0]
  ): Promise<void> {
    await saveComposerDraft(input)
    await refreshOutbox()
  }

  async function handleDiscardComposerDraft(draftId: number): Promise<void> {
    setError(null)
    try {
      await deleteDraftMessage(draftId)
      discardComposerDraft()
      toast.success(t('mailbox.draftDiscarded'))
      await refreshOutbox()
    } catch (discardError) {
      const messageText = getErrorMessage(discardError, t('mailbox.discardDraftError'))
      setError(messageText)
      toast.error(messageText)
    }
  }

  async function handleRetryOutbox(message: OutboxMessage): Promise<void> {
    setOutboxPending(true)
    setError(null)
    try {
      const result = await retryOutboxMessage(message.outboxId)
      toast.success(
        result.warning
          ? t('mail.composer.sentWithWarning', { warning: result.warning })
          : t('mail.composer.sent')
      )
      await refreshOutbox()
    } catch (retryError) {
      const messageText = getErrorMessage(retryError, t('mailbox.retrySendError'))
      setError(messageText)
      toast.error(messageText)
      await refreshOutbox()
    } finally {
      setOutboxPending(false)
    }
  }

  async function handleDeleteOutbox(message: OutboxMessage): Promise<void> {
    setOutboxPending(true)
    setError(null)
    try {
      if (message.status === 'draft') {
        await deleteDraftMessage(message.outboxId)
      } else {
        await deleteOutboxMessage(message.outboxId)
      }
      toast.success(t('mailbox.outboxDeleted'))
      await refreshOutbox()
    } catch (deleteError) {
      const messageText = getErrorMessage(deleteError, t('mailbox.deleteOutboxError'))
      setError(messageText)
      toast.error(messageText)
    } finally {
      setOutboxPending(false)
    }
  }

  function handleSelectAccount(accountId: string): void {
    if (accountId) setSelectedAccountId(accountId)
  }

  return (
    <main data-workspace="conversations" className="native-window flex h-screen min-h-screen flex-col overflow-hidden text-foreground">
      {showNoAccounts ? (
        <>
          <div className="relative shrink-0">
            <TitleBar
              platform={systemInfo?.platform}
              onAddAccount={handleOpenAddAccountWindow}
              onOpenSettings={() => {
                setSettingsInitialSection('general')
                setDialogKind('settings')
              }}
            />
          </div>
          <NoAccountsBody
            importingSql={backupImportBusy}
            actionsDisabled={backupImportBusy}
            onAddAccount={handleOpenAddAccountWindow}
            onImportBackup={handleImportBackup}
          />
        </>
      ) : (
        <ResizablePanelGroup
          id="onemail-conversation-layout-v1"
          orientation="horizontal"
          defaultLayout={conversationLayout.defaultLayout}
          onLayoutChanged={conversationLayout.onLayoutChanged}
          className="min-h-0 flex-1 overflow-hidden"
        >
          <ResizablePanel
            id="accounts"
            defaultSize="260px"
            minSize="220px"
            groupResizeBehavior="preserve-pixel-size"
          >
            <div className="workspace-sidebar flex h-full min-h-0 flex-col">
              <TitleBar
                platform={systemInfo?.platform}
                onAddAccount={handleOpenAddAccountWindow}
                onOpenSettings={() => {
                  setSettingsInitialSection('general')
                  setDialogKind('settings')
                }}
              />
              <AccountList
                accounts={accounts}
                selectedAccountId={selectedAccountId}
                syncingAccountIds={syncingAccountIds}
                onSelectAccount={handleSelectAccount}
                onRefreshAccount={(account) => {
                  void handleRefreshAccount(account)
                }}
                onEditAccount={(account) => {
                  setDialogAccountId(account.id)
                  setDialogKind('edit')
                }}
                onDeleteAccount={(account) => {
                  setDialogAccountId(account.id)
                  setDialogKind('delete')
                }}
                onResolveAccountWarning={(account) => {
                  setWarningAccountId(account.id)
                }}
              />
            </div>
          </ResizablePanel>

          <ResizableHandle />

          <ResizablePanel id="conversations" data-workspace-content minSize="600px">
            <div className="flex h-full min-h-0 flex-col overflow-hidden">
              <ConversationWorkspace
                accounts={realAccounts}
                settings={settings}
                accountId={selectedAccount.accountId}
                refreshKey={aiSessionEpoch}
                onCompose={() => { void openComposer('new') }}
                onOpenOutbox={() => setOutboxOpen(true)}
              />
              <StatusBar
                systemInfo={systemInfo}
                settings={settings}
                accountCount={realAccounts.length}
                messageCount={selectedAccount.messageCount ?? 0}
                syncNotice={syncNotice}
                error={error}
                syncErrors={syncFailures.map((failure) => {
                  const account = accounts.find((item) => item.accountId === failure.accountId)
                  return `${account?.address || account?.name || `#${failure.accountId}`}：${failure.error}`
                })}
                onDismissError={() => { setError(null); setSyncFailures([]) }}
                updateStatus={updateStatus}
                onOpenVersion={() => {
                  if (hasAvailableUpdate(updateStatus)) {
                    void openExternalUrl(ONEMAIL_HOMEPAGE_URL)
                    return
                  }
                  setSettingsInitialSection('about')
                  setDialogKind('settings')
                }}
                onInstallUpdate={() => { void installAppUpdate() }}
              />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      )}

      <EditAccountDialog
        account={dialogAccount ?? selectedAccount}
        open={dialogKind === 'edit'}
        onOpenChange={(open) => {
          setDialogKind(open ? 'edit' : null)
          if (!open) setDialogAccountId(null)
        }}
        onSubmit={handleUpdateAccount}
        onReauthorize={handleReauthorizeAccount}
      />
      <RemoveAccountDialog
        account={dialogAccount ?? selectedAccount}
        open={dialogKind === 'delete'}
        onOpenChange={(open) => {
          setDialogKind(open ? 'delete' : null)
          if (!open) setDialogAccountId(null)
        }}
        onConfirm={handleRemoveAccount}
      />
      {warningAccount ? (
        <AccountWarningDialog
          account={warningAccount}
          open={Boolean(warningAccountId)}
          syncing={syncingAccountIds.has(warningAccount.id)}
          onOpenChange={(open) => {
            if (!open) setWarningAccountId(null)
          }}
          onEdit={(account) => {
            setDialogAccountId(account.id)
            setDialogKind('edit')
          }}
          onRetry={(account) => {
            void handleRefreshAccount(account)
          }}
          onDelete={(account) => {
            setDialogAccountId(account.id)
            setDialogKind('delete')
          }}
          onReauthorize={handleReauthorizeAccount}
        />
      ) : null}
      <SettingsDialog
        open={dialogKind === 'settings'}
        settings={settings}
        systemInfo={systemInfo}
        updateStatus={updateStatus}
        aiSettings={aiSettings}
        initialSection={settingsInitialSection}
        onOpenChange={(open) => setDialogKind(open ? 'settings' : null)}
        onSubmit={handleUpdateSettings}
        onVerifyAi={handleVerifyAiSettings}
        onClearAi={handleClearAiSettings}
        onImported={reloadAfterBackupImport}
      />
      {aiSettings?.verified ? (
        <AiAssistant
          key={aiSessionEpoch}
          settings={aiSettings}
          launcherHidden={composerOpen}
          onChat={handleAiChat}
        />
      ) : null}
      <BackupImportDialog
        open={backupImportDialogOpen}
        defaultSource={backupImportSource}
        onOpenChange={setBackupImportDialogOpen}
        onBusyChange={setBackupImportBusy}
        onImported={handleBackupImported}
      />
      <OutlookImapHelpDialog
        accountLabel={outlookImapHelpAccount?.name}
        open={Boolean(outlookImapHelpAccount)}
        onOpenChange={(open) => {
          if (!open) setOutlookImapHelpAccount(null)
        }}
      />
      <MailComposer
        open={composerOpen}
        accounts={realAccounts}
        draft={composerDraft}
        pending={composerPending}
        onOpenChange={(open) => {
          if (!open) closeComposer()
        }}
        onSend={sendComposerDraft}
        onSaveDraft={handleSaveComposerDraft}
        onDiscardDraft={handleDiscardComposerDraft}
      />
      <OutboxPanel
        open={outboxOpen}
        pending={outboxPending}
        outboxMessages={outboxMessages}
        onOpenChange={setOutboxOpen}
        onRefresh={handleRefreshOutbox}
        onOpenDraft={(message) => {
          setOutboxOpen(false)
          openOutboxDraft(message)
        }}
        onRetry={(message) => {
          void handleRetryOutbox(message)
        }}
        onDelete={(message) => {
          void handleDeleteOutbox(message)
        }}
      />
    </main>
  )
}

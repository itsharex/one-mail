import { queryClient } from '@renderer/lib/query-client'
import { type BackupImportDialogSource } from '@renderer/components/backup/backup-import-dialog'
import { Account } from '@renderer/components/mail/types'
import {
  AccountUpdateInput,
  AiChatInput,
  AiChatResult,
  AiSettings,
  AiSettingsInput,
  BackupImportSource,
  BackupImportResult,
  BackupSyncDownloadResult,
  SettingsUpdateInput,
  SyncAllRunResult,
} from '@renderer/shared/types'
import {
  chatWithAi,
  clearAiSettings,
  deleteDraftMessage,
  deleteOutboxMessage,
  loadAccounts,
  loadAiSettings,
  openAddAccountWindow,
  reauthorizeAccount,
  removeAccount,
  retryOutboxMessage,
  saveSettings,
  syncAllAccounts,
  syncAccount,
  updateAccount,
  verifyAndSaveAiSettings,
} from '@renderer/pages/mailbox/api'
import { normalizeLocale, useI18n } from '@renderer/lib/i18n'
import { OutboxMessage } from '@renderer/pages/mailbox/api'
import { toast } from 'sonner'
import {
  getErrorMessage,
  getNextSelectedAccountId,
  shouldEditCredential,
  shouldShowOutlookImapHelp,
} from '../mailbox-utils'
import { useMailboxWorkspaceData, type SyncAllFailure } from './use-mailbox-workspace-data'
export type { DialogKind } from './use-mailbox-workspace-data'

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

function getSyncAllFailures(result: SyncAllRunResult): SyncAllFailure[] {
  return result.accounts
    .filter((item) => typeof item.accountId === 'number' && item.ok === false)
    .map((item) => ({ accountId: item.accountId, error: item.error?.trim() || '同步失败' }))
}

export function useMailboxWorkspaceController() {
  const data = useMailboxWorkspaceData()
  const { backupImportBusy, clearSyncing, discardComposerDraft,  finishSyncing, refreshAccounts, refreshMailbox, refreshOutbox, reloadAfterBackupImport, saveComposerDraft, selectedAccountId, setAccounts, setAiSettings, setBackupImportDialogOpen, setBackupImportSource, setDialogAccountId, setDialogKind, setError, setLocale, setNotice, setOutboxPending, setOutlookImapHelpAccount, setSelectedAccountId, setSettings, setSyncFailures, startSyncing, syncingAccountIds, t } = data
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
      setNotice((current) => current.state === 'running' && current.startedAt === startedAt
        ? { ...current, message: t('mailbox.refreshingList') }
        : current)
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

  return {
    ...data,
    handleAiChat,
    handleBackupImported,
    handleClearAiSettings,
    handleDeleteOutbox,
    handleDiscardComposerDraft,
    handleImportBackup,
    handleOpenAddAccountWindow,
    handleReauthorizeAccount,
    handleRefreshAccount,
    handleRemoveAccount,
    handleRetryOutbox,
    handleSaveComposerDraft,
    handleSelectAccount,
    handleUpdateAccount,
    handleUpdateSettings,
    handleVerifyAiSettings,
  }
}

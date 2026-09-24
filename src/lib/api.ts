import type {
  AccountSyncRunResult,
  AccountCreatedEvent,
  AccountCreateInput,
  AccountUpdateInput,
  AiChatInput,
  AiChatResult,
  AiSettings,
  AiSettingsInput,
  AppSettings,
  AppUpdateStatus,
  BackupImportProgress,
  BackupSyncDownloadResult,
  BackupSyncSettings,
  BackupSyncTestResult,
  BackupSyncTransferResult,
  BackupImportResult,
  MailAccount,
  MailAttachmentInput,
  ImapFolder,
  ImapFolderDiscoveryInput,
  MailboxChangedEvent,
  NewMailNotification,
  SettingsUpdateInput,
  SyncAllRunResult,
  SyncProgressEvent,
  SyncMode,
  SystemInfo
} from '@renderer/shared/types'
import type { ComposeDraftInput, ComposeDraft, SendMessageInput, SendMessageResult, OutboxMessage } from './api/types'
import type { Account } from '@renderer/components/mail/types'
import {
  toAccountList,
  getDefaultSelectedAccountId,
  createLocalDraft,
  toUiComposeDraft,
  toUiOutboxMessage,
  toSharedSendInput,
  requireRelatedMessageId,
  getStaticTranslation,
} from './api/formatters'

export async function loadInitialData(onStage?: (stage: 'database' | 'accounts') => void): Promise<{
  accounts: Account[]
  settings: AppSettings
  systemInfo: SystemInfo
  selectedAccountId: string
}> {
  onStage?.('database')
  const [settings, systemInfo] = await Promise.all([
    window.api.settings.get(),
    window.api.system.info()
  ])
  onStage?.('accounts')
  const [mailAccounts, accountStats] = await Promise.all([
    window.api.accounts.list(),
    window.api.messages.stats()
  ])
  const accounts = toAccountList(mailAccounts, accountStats)
  const selectedAccountId = getDefaultSelectedAccountId(accounts)

  return {
    accounts,
    settings,
    systemInfo,
    selectedAccountId
  }
}

export async function createAccount(input: AccountCreateInput): Promise<MailAccount> {
  return window.api.accounts.create(input)
}

export async function discoverImapFolders(
  input: ImapFolderDiscoveryInput
): Promise<ImapFolder[]> {
  return window.api.accounts.discoverFolders(input)
}

export async function openAddAccountWindow(): Promise<boolean> {
  return window.api.accounts.openAddWindow()
}

export function onAccountCreated(callback: (event: AccountCreatedEvent) => void): () => void {
  const onCreated = window.api?.accounts?.onCreated
  if (typeof onCreated !== 'function') return () => {}

  return onCreated(callback)
}

export async function updateAccount(input: AccountUpdateInput): Promise<MailAccount> {
  return window.api.accounts.update(input)
}

export async function reauthorizeAccount(accountId: number): Promise<MailAccount> {
  return window.api.accounts.reauthorize(accountId)
}

export async function removeAccount(accountId: number): Promise<boolean> {
  return window.api.accounts.remove(accountId)
}

export async function syncAccount(
  accountId: number,
  mode: SyncMode = 'refresh'
): Promise<AccountSyncRunResult> {
  const startAccount = window.api?.sync?.startAccount
  if (typeof startAccount !== 'function') {
    throw new Error(getStaticTranslation('sync.serviceUnavailable'))
  }

  return startAccount(accountId, mode)
}

export async function syncAllAccounts(mode: SyncMode = 'refresh'): Promise<SyncAllRunResult> {
  const startAll = window.api?.sync?.startAll
  if (typeof startAll !== 'function') {
    throw new Error(getStaticTranslation('sync.serviceUnavailable'))
  }

  return startAll(mode)
}

export function onSyncProgress(callback: (event: SyncProgressEvent) => void): () => void {
  return window.api?.sync?.onProgress?.(callback) ?? (() => {})
}

export function onMailboxChanged(callback: (event: MailboxChangedEvent) => void): () => void {
  const onChanged = window.api?.sync?.onMailboxChanged
  if (typeof onChanged !== 'function') return () => {}

  return onChanged(callback)
}

export function onNewMail(callback: (notification: NewMailNotification) => void): () => void {
  const onNotification = window.api?.notifications?.onNewMail
  if (typeof onNotification !== 'function') return () => {}

  return onNotification(callback)
}

export async function saveSettings(input: SettingsUpdateInput): Promise<AppSettings> {
  return window.api.settings.update(input)
}

export async function loadAiSettings(): Promise<AiSettings> {
  return window.api.ai.getSettings()
}

export async function verifyAndSaveAiSettings(input: AiSettingsInput): Promise<AiSettings> {
  return window.api.ai.verifyAndSave(input)
}

export async function clearAiSettings(): Promise<AiSettings> {
  return window.api.ai.clear()
}

export async function chatWithAi(input: AiChatInput): Promise<AiChatResult> {
  return window.api.ai.chat(input)
}

export async function exportSqlBackup(): Promise<string | null> {
  return window.api.settings.exportSql()
}

export async function importSqlBackup(operationId?: string): Promise<BackupImportResult> {
  return window.api.settings.importSql(operationId)
}

export async function loadBackupSyncSettings(): Promise<BackupSyncSettings> {
  return window.api.settings.getBackupSync()
}

export async function saveBackupSyncSettings(
  input: BackupSyncSettings
): Promise<BackupSyncSettings> {
  return window.api.settings.updateBackupSync(input)
}

export async function testBackupSyncSettings(
  input: BackupSyncSettings
): Promise<BackupSyncTestResult> {
  return window.api.settings.testBackupSync(input)
}

export async function uploadBackupSync(): Promise<BackupSyncTransferResult> {
  return window.api.settings.uploadBackupSync()
}

export async function downloadBackupSync(operationId?: string): Promise<BackupSyncDownloadResult> {
  return window.api.settings.downloadBackupSync(operationId)
}

export async function importBackupFromRemote(
  input: BackupSyncSettings,
  operationId?: string
): Promise<BackupSyncDownloadResult> {
  return window.api.settings.importBackupFromRemote(input, operationId)
}

export function onBackupImportProgress(
  callback: (progress: BackupImportProgress) => void
): () => void {
  return window.api.settings.onBackupImportProgress(callback)
}

export async function revealPathInFileManager(path: string): Promise<boolean> {
  return window.api.system.revealPath(path)
}

export async function openExternalUrl(url: string): Promise<boolean> {
  return window.api.system.openExternal(url)
}

export async function getAppUpdateStatus(): Promise<AppUpdateStatus> {
  const status = window.api?.updates?.status
  if (typeof status !== 'function') {
    return {
      state: 'unsupported',
      currentVersion: '',
      message: getStaticTranslation('settings.about.updateServiceUnavailable'),
      updatedAt: new Date().toISOString()
    }
  }

  return status()
}

export function onAppUpdateStatus(callback: (status: AppUpdateStatus) => void): () => void {
  const onStatus = window.api?.updates?.onStatus
  if (typeof onStatus !== 'function') return () => {}

  return onStatus(callback)
}

export async function installAppUpdate(): Promise<boolean> {
  const install = window.api?.updates?.install
  if (typeof install !== 'function') {
    return false
  }

  return install()
}

export async function loadAccounts(): Promise<Account[]> {
  const [accounts, accountStats] = await Promise.all([
    window.api.accounts.list(),
    window.api.messages.stats()
  ])

  return toAccountList(accounts, accountStats)
}

export async function createComposeDraft(input: ComposeDraftInput): Promise<ComposeDraft> {
  const compose = window.api.compose
  if (input.kind === 'reply' || input.kind === 'reply_all') {
    return toUiComposeDraft(
      await compose.createReplyDraft({
        messageId: requireRelatedMessageId(input),
        mode: input.kind
      })
    )
  }

  if (input.kind === 'forward') {
    return toUiComposeDraft(
      await compose.createForwardDraft({
        messageId: requireRelatedMessageId(input)
      })
    )
  }

  return createLocalDraft(input)
}

export async function sendComposedMessage(input: SendMessageInput): Promise<SendMessageResult> {
  const result = await window.api.compose.send(toSharedSendInput(input))
  return {
    sent: result.status === 'sent',
    messageId: result.rfc822MessageId,
    outboxId: result.outboxId,
    warning: result.warning ?? result.error
  }
}

export async function selectMailAttachments(): Promise<MailAttachmentInput[]> {
  return window.api.compose.selectAttachments()
}

export async function saveComposedDraft(input: SendMessageInput): Promise<OutboxMessage> {
  return toUiOutboxMessage(await window.api.compose.saveDraft(toSharedSendInput(input)))
}

export async function loadOutboxMessages(): Promise<OutboxMessage[]> {
  const messages = await window.api.compose.listOutbox({
    statuses: ['draft', 'failed', 'sending', 'sent'],
    limit: 100
  })
  return messages.map(toUiOutboxMessage)
}

export async function retryOutboxMessage(outboxId: number): Promise<SendMessageResult> {
  const result = await window.api.compose.retry(outboxId)
  return {
    sent: result.status === 'sent',
    messageId: result.rfc822MessageId,
    outboxId: result.outboxId,
    warning: result.warning ?? result.error
  }
}

export async function deleteOutboxMessage(outboxId: number): Promise<boolean> {
  return window.api.compose.deleteOutbox(outboxId)
}

export async function deleteDraftMessage(outboxId: number): Promise<boolean> {
  return window.api.compose.deleteDraft(outboxId)
}

export type { ComposeKind, ComposeDraftInput, ComposeDraft, SendMessageInput, SendMessageResult, OutboxMessage } from './api/types'
export { getPlatformName, toUiComposeDraft, toSharedSendInput } from './api/formatters'

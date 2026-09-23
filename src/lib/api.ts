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
  AppUpdateCheckResult,
  AppUpdateStatus,
  BackupImportProgress,
  BackupSyncDownloadResult,
  BackupSyncSettings,
  BackupSyncTestResult,
  BackupSyncTransferResult,
  BackupImportResult,
  AttachmentDownloadResult,
  MailAccount,
  MailAttachmentInput,
  ImapFolder,
  ImapFolderDiscoveryInput,
  MessageBulkReadStateResult,
  MessageReadStateUpdate,
  MessageListQuery,
  MailboxChangedEvent,
  NewMailNotification,
  SettingsUpdateInput,
  SyncAllRunResult,
  SyncProgressEvent,
  SyncMode,
  SystemInfo
} from '@renderer/shared/types'
import type { ComposeDraftInput, ComposeDraft, SendMessageInput, SendMessageResult, DeleteMessageInput, DeleteMessageResult, BulkDeleteMessagesInput, BulkDeleteMessagesResult, HideMessageResult, RestoreMessageResult, OutboxMessage } from './api/types'
import type { Account, Message } from '@renderer/components/mail/types'
import {
  toAccountList,
  getDefaultSelectedAccountId,
  toMessage,
  createLocalDraft,
  toUiComposeDraft,
  toUiOutboxMessage,
  toSharedSendInput,
  requireRelatedMessageId,
  mergeMessageBody,
  getStaticTranslation,
} from './api/formatters'

export async function loadInitialData(): Promise<{
  accounts: Account[]
  settings: AppSettings
  systemInfo: SystemInfo
  selectedAccountId: string
}> {
  const [mailAccounts, accountStats, settings, systemInfo] = await Promise.all([
    window.api.accounts.list(),
    window.api.messages.stats(),
    window.api.settings.get(),
    window.api.system.info()
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

export async function revealDatabaseInFileManager(): Promise<boolean> {
  return window.api.system.revealDatabase()
}

export async function revealPathInFileManager(path: string): Promise<boolean> {
  return window.api.system.revealPath(path)
}

export async function openExternalUrl(url: string): Promise<boolean> {
  return window.api.system.openExternal(url)
}

export async function checkForAppUpdates(): Promise<AppUpdateCheckResult> {
  const checkUpdates = window.api?.updates?.check
  if (typeof checkUpdates !== 'function') {
    return {
      status: 'unsupported',
      currentVersion: '',
      message: getStaticTranslation('settings.about.updateServiceUnavailable')
    }
  }

  return checkUpdates()
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

export async function loadMessages(query: MessageListQuery): Promise<Message[]> {
  const messages = await window.api.messages.list(query)
  return messages.map(toMessage)
}

export async function loadMessageDetail(messageId: number): Promise<Message | null> {
  const message = await window.api.messages.get(messageId)
  return message ? toMessage(message) : null
}

export async function loadMessageBody(message: Message): Promise<Message> {
  const result = await window.api.messages.loadBody(message.messageId)
  if (!result.body) {
    return {
      ...message,
      bodyStatus: result.error ? 'error' : message.bodyStatus,
      bodyError: result.error
    }
  }

  const detail = await window.api.messages.get(message.messageId)
  if (detail) return toMessage(detail)

  return mergeMessageBody(message, result.body)
}

export async function setMessageReadState(
  messageId: number,
  isRead: boolean
): Promise<MessageReadStateUpdate> {
  return window.api.messages.setReadState(messageId, isRead)
}

export async function bulkSetMessageReadState(
  messageIds: number[],
  isRead: boolean
): Promise<MessageBulkReadStateResult> {
  return window.api.messages.bulkSetReadState({ messageIds, isRead })
}

export async function markAllMessagesRead(
  query: MessageListQuery
): Promise<MessageBulkReadStateResult> {
  return window.api.messages.markAllRead({ query })
}

export async function downloadAttachment(attachmentId: number): Promise<AttachmentDownloadResult> {
  return window.api.messages.downloadAttachment(attachmentId)
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

export async function deleteMessage(input: DeleteMessageInput): Promise<DeleteMessageResult> {
  const result = await window.api.messages.delete({
    messageId: input.messageId,
    mode: 'permanent'
  })
  return {
    messageId: result.messageId,
    deleted: result.deleted,
    permanent: result.mode === 'permanent',
    hidden: result.mode === 'local_hide',
    error: result.error
  }
}

export async function bulkDeleteMessages(
  input: BulkDeleteMessagesInput
): Promise<BulkDeleteMessagesResult> {
  return window.api.messages.bulkDelete({
    messageIds: input.messageIds,
    mode: 'permanent'
  })
}

export async function hideMessage(messageId: number): Promise<HideMessageResult> {
  const result = await window.api.messages.hideLocal(messageId)
  return {
    messageId: result.messageId,
    hidden: result.deleted || result.localOnly
  }
}

export async function restoreMessage(messageId: number): Promise<RestoreMessageResult> {
  const result = await window.api.messages.restore(messageId)
  return {
    messageId: result.messageId,
    restored: result.restored
  }
}


export { MESSAGE_LIST_PAGE_SIZE } from './api/types'
export type { ComposeKind, ComposeDraftInput, ComposeDraft, SendMessageInput, SendMessageResult, DeleteMessageInput, DeleteMessageResult, BulkDeleteMessagesInput, BulkDeleteMessagesResult, HideMessageResult, RestoreMessageResult, OutboxMessage } from './api/types'
export { getPlatformName, toUiComposeDraft, toSharedSendInput, toMessageQuery } from './api/formatters'

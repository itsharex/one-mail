import type { ConversationListQuery, ConversationLocation, ConversationMessage, ConversationMessagesQuery, ConversationSummary } from '../conversations'
import type { AccountCreateInput, AccountCreatedEvent, AccountUpdateInput, ImapFolder, ImapFolderDiscoveryInput, MailAccount, SyncMode } from './accounts'
import type { AccountMailboxStats, AttachmentDownloadResult, ComposeDraft, ForwardDraftInput, MailAttachmentInput, MailMessageBodyLoadResult, MailMessageDetail, MailMessageSummary, MailSendInput, MailSendResult, MessageBulkDeleteInput, MessageBulkDeleteResult, MessageBulkReadStateInput, MessageBulkReadStateResult, MessageDeleteInput, MessageDeleteResult, MessageListQuery, MessageMarkAllReadInput, MessageReadStateUpdate, MessageRestoreResult, OutboxListQuery, OutboxMessage, ReplyDraftInput } from './messages'
import type { AccountSyncRunResult, MailboxChangedEvent, NewMailNotification, NotificationStatus, SyncAllRunResult, SyncProgressEvent, SyncStatus } from './sync'
import type { AiChatInput, AiChatResult, AiSettings, AiSettingsInput, AppSettings, AppTheme, AppUpdateCheckResult, AppUpdateStatus, BackupImportProgress, BackupImportResult, BackupSyncDownloadResult, BackupSyncSettings, BackupSyncTestResult, BackupSyncTransferResult, SettingsUpdateInput, SystemInfo } from './settings'

export type OneMailApi = {
  conversations: {
    list: (query?: ConversationListQuery) => Promise<ConversationSummary[]>
    messages: (query: ConversationMessagesQuery) => Promise<ConversationMessage[]>
    findMessage: (messageId: number) => Promise<ConversationLocation | null>
  }
  accounts: {
    list: () => Promise<MailAccount[]>
    create: (input: AccountCreateInput) => Promise<MailAccount>
    discoverFolders: (input: ImapFolderDiscoveryInput) => Promise<ImapFolder[]>
    onCreated: (callback: (event: AccountCreatedEvent) => void) => () => void
    openAddWindow: () => Promise<boolean>
    closeAddWindow: () => Promise<boolean>
    update: (input: AccountUpdateInput) => Promise<MailAccount>
    reauthorize: (accountId: number) => Promise<MailAccount>
    disable: (accountId: number) => Promise<MailAccount>
    remove: (accountId: number) => Promise<boolean>
  }
  logos: {
    get: (domain: string) => Promise<string | null>
  }
  messages: {
    list: (query?: MessageListQuery) => Promise<MailMessageSummary[]>
    stats: () => Promise<AccountMailboxStats[]>
    get: (messageId: number) => Promise<MailMessageDetail | null>
    loadBody: (messageId: number) => Promise<MailMessageBodyLoadResult>
    setReadState: (messageId: number, isRead: boolean) => Promise<MessageReadStateUpdate>
    bulkSetReadState: (input: MessageBulkReadStateInput) => Promise<MessageBulkReadStateResult>
    markAllRead: (input?: MessageMarkAllReadInput) => Promise<MessageBulkReadStateResult>
    downloadAttachment: (attachmentId: number) => Promise<AttachmentDownloadResult>
    delete: (input: MessageDeleteInput) => Promise<MessageDeleteResult>
    bulkDelete: (input: MessageBulkDeleteInput) => Promise<MessageBulkDeleteResult>
    hideLocal: (messageId: number) => Promise<MessageDeleteResult>
    restore: (messageId: number) => Promise<MessageRestoreResult>
  }
  compose: {
    createReplyDraft: (input: ReplyDraftInput) => Promise<ComposeDraft>
    createForwardDraft: (input: ForwardDraftInput) => Promise<ComposeDraft>
    send: (input: MailSendInput) => Promise<MailSendResult>
    selectAttachments: () => Promise<MailAttachmentInput[]>
    listOutbox: (query?: OutboxListQuery) => Promise<OutboxMessage[]>
    saveDraft: (input: MailSendInput) => Promise<OutboxMessage>
    deleteDraft: (outboxId: number) => Promise<boolean>
    retry: (outboxId: number) => Promise<MailSendResult>
    deleteOutbox: (outboxId: number) => Promise<boolean>
    onSent: (callback: (result: MailSendResult) => void) => () => void
  }
  sync: {
    startAll: (mode?: SyncMode) => Promise<SyncAllRunResult>
    startAccount: (accountId: number, mode?: SyncMode) => Promise<AccountSyncRunResult>
    status: () => Promise<SyncStatus>
    onProgress: (callback: (event: SyncProgressEvent) => void) => () => void
    onMailboxChanged: (callback: (event: MailboxChangedEvent) => void) => () => void
  }
  notifications: {
    status: () => Promise<NotificationStatus>
    onNewMail: (callback: (notification: NewMailNotification) => void) => () => void
  }
  settings: {
    get: () => Promise<AppSettings>
    update: (input: SettingsUpdateInput) => Promise<AppSettings>
    getBackupSync: () => Promise<BackupSyncSettings>
    updateBackupSync: (input: BackupSyncSettings) => Promise<BackupSyncSettings>
    testBackupSync: (input: BackupSyncSettings) => Promise<BackupSyncTestResult>
    uploadBackupSync: () => Promise<BackupSyncTransferResult>
    downloadBackupSync: (operationId?: string) => Promise<BackupSyncDownloadResult>
    importBackupFromRemote: (
      input: BackupSyncSettings,
      operationId?: string
    ) => Promise<BackupSyncDownloadResult>
    exportSql: () => Promise<string | null>
    importSql: (operationId?: string) => Promise<BackupImportResult>
    onBackupImportProgress: (callback: (progress: BackupImportProgress) => void) => () => void
  }
  ai: {
    getSettings: () => Promise<AiSettings>
    verifyAndSave: (input: AiSettingsInput) => Promise<AiSettings>
    clear: () => Promise<AiSettings>
    chat: (input: AiChatInput) => Promise<AiChatResult>
  }
  updates: {
    check: () => Promise<AppUpdateCheckResult>
    status: () => Promise<AppUpdateStatus>
    install: () => Promise<boolean>
    onStatus: (callback: (status: AppUpdateStatus) => void) => () => void
  }
  system: {
    info: () => Promise<SystemInfo>
    setTitleBarTheme: (theme: AppTheme) => Promise<boolean>
    revealDatabase: () => Promise<boolean>
    revealPath: (path: string) => Promise<boolean>
    openExternal: (url: string) => Promise<boolean>
  }
}

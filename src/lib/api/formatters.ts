import type {
  AccountMailboxStats,
  ComposeDraft as SharedComposeDraft,
  MailAccount,
  MailAddressInput,
  MailMessageDetail,
  MailMessageBody,
  MailMessageSummary,
  MailSendInput,
  MessageFilterTag,
  MessageListQuery,
  OutboxMessage as SharedOutboxMessage,
  SystemInfo
} from '@renderer/shared/types'
import type { Account, Message, MessageFolderRole } from '@renderer/components/mail/types'
import { normalizeMailBodyText, normalizeMailDisplayText } from '@renderer/shared/mail-text'
import { normalizeLocale, translate } from '@renderer/lib/i18n'
import {
  MESSAGE_LIST_PAGE_SIZE,
  type ComposeDraftInput,
  type ComposeDraft,
  type SendMessageInput,
  type OutboxMessage,
} from './types'

const platformLabel: Partial<Record<NodeJS.Platform, string>> = {
  darwin: 'macOS',
  win32: 'Windows',
  linux: 'Linux'
}

const ATTACHMENT_METADATA_PENDING_SIZE = '__pending__'

export function getPlatformName(info?: SystemInfo): string {
  if (!info) return 'Desktop'
  return platformLabel[info.platform] ?? info.platform
}

export function toAccountList(accounts: MailAccount[], accountStats: AccountMailboxStats[]): Account[] {
  const statsByAccount = new Map(accountStats.map((stats) => [stats.accountId, stats]))
  const totalUnread = accountStats.reduce((sum, stats) => sum + stats.unreadCount, 0)
  const totalMessages = accountStats.reduce((sum, stats) => sum + stats.totalCount, 0)

  const accountItems = accounts.map((account) => {
    const stats = statsByAccount.get(account.accountId)

    return {
      id: String(account.accountId),
      accountId: account.accountId,
      providerKey: account.providerKey,
      authType: account.authType,
      name: formatAccountName(account),
      address: account.email,
      unread: stats?.unreadCount ?? 0,
      messageCount: stats?.totalCount ?? 0,
      credentialState: account.credentialState,
      status: account.status,
      connectionStatus: account.connectionStatus ?? 'connected',
      lastError: account.lastError,
      accent: account.syncEnabled ? 'bg-muted-foreground' : 'bg-muted'
    }
  })

  if (accounts.length <= 2) {
    return accountItems
  }

  return [
    {
      id: 'all',
      providerKey: 'all',
      authType: 'manual',
      name: '',
      address: '',
      unread: totalUnread,
      messageCount: totalMessages,
      status: accounts.length > 0 ? 'active' : 'empty',
      accent: 'bg-primary'
    },
    ...accountItems
  ]
}

export function getDefaultSelectedAccountId(accounts: Account[]): string {
  return accounts.find((account) => account.id === 'all')?.id ?? accounts[0]?.id ?? ''
}

function formatAccountName(account: MailAccount): string {
  const label = account.accountLabel?.trim()
  if (!label || label === account.email) return account.email
  return `${label}(${account.email})`
}

export function toMessage(message: MailMessageSummary | MailMessageDetail): Message {
  const detailLoaded = 'attachments' in message
  const body = detailLoaded ? message.body : undefined
  const fromName = normalizeMailDisplayText(message.fromName)
  const fromEmail = normalizeMailDisplayText(message.fromEmail)
  const subject = normalizeMailDisplayText(message.subject) ?? ''
  const snippet = normalizeMailDisplayText(message.snippet) ?? ''
  const bodyText = normalizeMailBodyText(body?.bodyText)

  return {
    id: String(message.messageId),
    messageId: message.messageId,
    accountId: message.accountId,
    folderId: message.folderId,
    folderRole: readOptionalString(message, 'folderRole') as MessageFolderRole | undefined,
    folderName: readOptionalString(message, 'folderName'),
    from: fromName ?? fromEmail ?? '',
    fromAddress: fromEmail,
    to: normalizeMailDisplayText(readOptionalString(message, 'to')),
    cc: normalizeMailDisplayText(readOptionalString(message, 'cc')),
    replyTo: normalizeMailDisplayText(readOptionalString(message, 'replyTo')),
    messageRfc822Id: normalizeMailDisplayText(readOptionalString(message, 'messageRfc822Id')),
    references: normalizeMailDisplayText(readOptionalString(message, 'references')),
    subject,
    preview: snippet,
    verificationCode: normalizeMailDisplayText(message.verificationCode),
    body: bodyTextToParagraphs(bodyText),
    html: body?.bodyHtmlSanitized,
    bodyStatus: message.bodyStatus,
    bodyError: message.bodyError,
    bodyLoaded: detailLoaded && message.bodyStatus === 'ready',
    detailLoaded,
    externalImagesBlocked: body?.externalImagesBlocked,
    receivedAt: message.receivedAt,
    time: formatMessageTime(message.receivedAt),
    dateLabel: formatMessageDate(message.receivedAt),
    unread: !message.isRead,
    starred: message.isStarred,
    attachments:
      'attachments' in message
        ? message.attachments
            .filter((attachment) => attachment.filename.trim() && attachment.sizeBytes > 0)
            .map((attachment) => ({
              id: attachment.attachmentId,
              name: normalizeMailDisplayText(attachment.filename) ?? attachment.filename,
              size: formatBytes(attachment.sizeBytes),
              type: attachment.mimeType ?? '',
              disposition: attachment.contentDisposition
            }))
        : message.hasAttachments
          ? [{ name: '', size: ATTACHMENT_METADATA_PENDING_SIZE, type: '' }]
          : []
  }
}

export function createLocalDraft(input: ComposeDraftInput): ComposeDraft {
  return {
    kind: input.kind,
    accountId: input.accountId,
    relatedMessageId: input.relatedMessageId,
    to: [],
    cc: [],
    bcc: [],
    subject: '',
    bodyText: '',
    bodyHtml: undefined
  }
}

export function toUiComposeDraft(draft: SharedComposeDraft): ComposeDraft {
  return {
    kind: draft.mode,
    accountId: draft.accountId,
    relatedMessageId: draft.relatedMessageId,
    to: draft.to.map(formatAddressInput),
    cc: draft.cc.map(formatAddressInput),
    bcc: draft.bcc.map(formatAddressInput),
    subject: draft.subject ?? '',
    bodyText: draft.bodyText ?? '',
    bodyHtml: draft.bodyHtml,
    forwardAttachments: draft.forwardAttachments?.map((attachment) => ({
      sourceMessageId: draft.relatedMessageId,
      sourceAttachmentId: attachment.attachmentId,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes
    })),
    inReplyTo: draft.inReplyTo,
    references: draft.referencesHeader
  }
}

export function toUiOutboxMessage(message: SharedOutboxMessage): OutboxMessage {
  return {
    outboxId: message.outboxId,
    kind: message.composeKind,
    accountId: message.accountId,
    relatedMessageId: message.relatedMessageId,
    status: message.status,
    to: message.to.map(formatAddressInput),
    cc: message.cc.map(formatAddressInput),
    bcc: message.bcc.map(formatAddressInput),
    subject: message.subject ?? '',
    bodyText: message.bodyText ?? '',
    bodyHtml: message.bodyHtml,
    attachments: message.attachments ?? [],
    inReplyTo: message.inReplyTo,
    references: message.referencesHeader,
    lastError: message.lastError,
    lastWarning: message.lastWarning,
    updatedAt: message.updatedAt
  }
}

export function toSharedSendInput(input: SendMessageInput): MailSendInput {
  return {
    outboxId: input.draftId,
    accountId: input.accountId,
    mode: input.kind,
    relatedMessageId: input.relatedMessageId,
    to: input.to.map(parseAddressInput),
    cc: input.cc?.map(parseAddressInput),
    bcc: input.bcc?.map(parseAddressInput),
    subject: input.subject,
    bodyText: input.bodyText,
    bodyHtml: input.bodyHtml,
    inReplyTo: input.inReplyTo,
    referencesHeader: input.references,
    attachments: input.attachments ?? input.attachmentPaths?.map((filePath) => ({ filePath }))
  }
}

export function requireRelatedMessageId(input: ComposeDraftInput): number {
  if (!input.relatedMessageId) {
    throw new Error('Missing source message for reply or forward draft.')
  }

  return input.relatedMessageId
}

function formatAddressInput(address: MailAddressInput): string {
  return address.name ? `${address.name} <${address.email}>` : address.email
}

function parseAddressInput(value: string): MailAddressInput {
  const trimmed = value.trim()
  const match = /^(.*?)<([^<>]+)>$/.exec(trimmed)
  if (!match) return { email: trimmed }

  return {
    name: match[1].trim() || undefined,
    email: match[2].trim()
  }
}

function readOptionalString(source: unknown, key: string): string | undefined {
  if (!source || typeof source !== 'object') return undefined
  const value = (source as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}

export function mergeMessageBody(message: Message, body: MailMessageBody): Message {
  const bodyText = normalizeMailBodyText(body.bodyText)

  return {
    ...message,
    body: bodyTextToParagraphs(bodyText),
    html: body.bodyHtmlSanitized,
    bodyStatus: 'ready',
    bodyError: undefined,
    bodyLoaded: true,
    detailLoaded: true,
    externalImagesBlocked: body.externalImagesBlocked
  }
}

function bodyTextToParagraphs(value?: string): string[] {
  if (!value) return []
  return value
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
}

function formatBytes(value: number): string {
  if (!value) return ''
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function formatMessageTime(value?: string): string {
  if (!value) return '--:--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--:--'

  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

function formatMessageDate(value?: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  const today = new Date()
  if (date.toDateString() === today.toDateString()) return ''

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric'
  }).format(date)
}

export function toMessageQuery(
  selectedAccountId: string,
  filters: MessageFilterTag[],
  pagination?: Pick<MessageListQuery, 'limit' | 'offset'>,
  searchKeyword?: string
): MessageListQuery {
  const keyword = searchKeyword?.trim()

  return {
    accountId: selectedAccountId === 'all' ? undefined : Number(selectedAccountId),
    filters,
    keyword: keyword || undefined,
    limit: pagination?.limit ?? MESSAGE_LIST_PAGE_SIZE,
    offset: pagination?.offset ?? 0
  }
}

export function getStaticTranslation(key: Parameters<typeof translate>[1]): string {
  return translate(normalizeLocale(document.documentElement.lang), key)
}

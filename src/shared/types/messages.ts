

export type MailMessageSummary = {
  messageId: number
  accountId: number
  folderId: number
  folderRole?: string
  folderName?: string
  subject?: string
  fromName?: string
  fromEmail?: string
  to?: string
  cc?: string
  replyTo?: string
  messageRfc822Id?: string
  references?: string
  receivedAt?: string
  snippet?: string
  isRead: boolean
  isStarred: boolean
  hasAttachments: boolean
  bodyStatus: 'none' | 'loading' | 'ready' | 'error'
  bodyError?: string
  verificationCode?: string
}

export type AccountMailboxStats = {
  accountId: number
  totalCount: number
  unreadCount: number
  latestMessageAt?: number | null
}

export type MailMessageAttachment = {
  attachmentId: number
  filename: string
  mimeType?: string
  contentDisposition?: 'attachment' | 'inline'
  sizeBytes: number
}

export type MailMessageBody = {
  messageId: number
  bodyText?: string
  bodyHtmlSanitized?: string
  externalImagesBlocked: boolean
}

export type MailMessageBodyLoadResult = {
  body: MailMessageBody | null
  error?: string
}

export type MailMessageDetail = MailMessageSummary & {
  sizeBytes: number
  body?: MailMessageBody
  attachments: MailMessageAttachment[]
}

export type MailAddressInput = {
  name?: string
  email: string
}

export type MailComposeMode = 'new' | 'reply' | 'reply_all' | 'forward'

export type MailAttachmentInput = {
  filePath?: string
  filename?: string
  mimeType?: string
  sizeBytes?: number
  sourceMessageId?: number
  sourceAttachmentId?: number
}

export type MailSendInput = {
  outboxId?: number
  accountId: number
  mode: MailComposeMode
  relatedMessageId?: number
  to: MailAddressInput[]
  cc?: MailAddressInput[]
  bcc?: MailAddressInput[]
  subject?: string
  bodyText?: string
  bodyHtml?: string
  attachments?: MailAttachmentInput[]
  inReplyTo?: string
  referencesHeader?: string
}

export type MailSendResult = {
  outboxId: number
  accountId: number
  status: OutboxMessage['status']
  rfc822MessageId: string
  sentAt?: string
  warning?: string
  error?: string
}

export type ReplyDraftInput = {
  messageId: number
  mode: Extract<MailComposeMode, 'reply' | 'reply_all'>
}

export type ForwardDraftInput = {
  messageId: number
}

export type ForwardAttachmentCandidate = {
  attachmentId: number
  filename: string
  mimeType?: string
  sizeBytes: number
  selected: boolean
}

export type ComposeDraft = {
  accountId: number
  mode: MailComposeMode
  relatedMessageId?: number
  to: MailAddressInput[]
  cc: MailAddressInput[]
  bcc: MailAddressInput[]
  subject?: string
  bodyText?: string
  bodyHtml?: string
  inReplyTo?: string
  referencesHeader?: string
  forwardAttachments?: ForwardAttachmentCandidate[]
}

export type OutboxMessage = {
  outboxId: number
  accountId: number
  relatedMessageId?: number
  composeKind: MailComposeMode
  status: 'draft' | 'queued' | 'sending' | 'sent' | 'failed' | 'cancelled' | 'deleted'
  rfc822MessageId: string
  from?: MailAddressInput
  subject?: string
  bodyText?: string
  bodyHtml?: string
  inReplyTo?: string
  referencesHeader?: string
  attachments?: MailAttachmentInput[]
  to: MailAddressInput[]
  cc: MailAddressInput[]
  bcc: MailAddressInput[]
  sentAt?: string
  deletedAt?: string
  lastError?: string
  lastWarning?: string
  createdAt: string
  updatedAt: string
}

export type OutboxListQuery = {
  statuses?: OutboxMessage['status'][]
  limit?: number
}

export type MessageReadStateUpdate = {
  messageId: number
  accountId: number
  folderId: number
  isRead: boolean
  remoteSynced?: boolean
}

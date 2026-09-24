import type { MailAttachmentInput, OutboxMessage as SharedOutboxMessage } from '@renderer/shared/types'

export type ComposeKind = 'new' | 'reply' | 'reply_all' | 'forward'

export type ComposeDraftInput = {
  kind: ComposeKind
  accountId: number
  relatedMessageId?: number
}

export type ComposeDraft = {
  draftId?: number
  kind: ComposeKind
  accountId: number
  relatedMessageId?: number
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  bodyText: string
  bodyHtml?: string
  attachments?: MailAttachmentInput[]
  forwardAttachments?: MailAttachmentInput[]
  inReplyTo?: string
  references?: string
}

export type SendMessageInput = {
  draftId?: number
  kind: ComposeKind
  accountId: number
  relatedMessageId?: number
  to: string[]
  cc?: string[]
  bcc?: string[]
  subject: string
  bodyText: string
  bodyHtml?: string
  attachments?: MailAttachmentInput[]
  attachmentPaths?: string[]
  inReplyTo?: string
  references?: string
}

export type SendMessageResult = {
  sent: boolean
  messageId?: string
  outboxId?: number
  warning?: string
}

export type OutboxMessage = {
  outboxId: number
  kind: ComposeKind
  accountId: number
  relatedMessageId?: number
  status: SharedOutboxMessage['status']
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  bodyText: string
  bodyHtml?: string
  attachments: MailAttachmentInput[]
  inReplyTo?: string
  references?: string
  lastError?: string
  lastWarning?: string
  updatedAt: string
}

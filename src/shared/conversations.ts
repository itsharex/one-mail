export type ConversationAddress = {
  email: string
  name: string | null
}

export type ConversationMessage = {
  id: string
  source: 'message' | 'outbox'
  messageId: number | null
  outboxId: number | null
  accountId: number
  direction: 'incoming' | 'outgoing'
  subject: string | null
  fromName: string | null
  fromEmail: string | null
  to: ConversationAddress[]
  cc: ConversationAddress[]
  replyTo: ConversationAddress[]
  messageRfc822Id: string | null
  inReplyTo: string | null
  references: string | null
  receivedAt: string
  snippet: string | null
  isRead: boolean
  hasAttachments: boolean
  bodyText: string | null
  bodyHtmlSanitized: string | null
  status: string
}

export type ConversationSummary = {
  conversationId: string
  displayName: string
  participants: ConversationAddress[]
  isGroup: boolean
  iconUrl?: string | null
  lastMessage: ConversationMessage
  messageCount: number
  unreadCount: number
  accountIds: number[]
}

export type ConversationListQuery = {
  accountId?: number
  keyword?: string
  limit?: number
  offset?: number
}

export type ConversationMessagesQuery = {
  conversationId: string
  accountId?: number
  limit?: number
  offset?: number
}

export type ConversationLocation = {
  conversation: ConversationSummary
  offset: number
}

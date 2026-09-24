import type { AccountConnectionStatus, AccountStatus, SyncMode } from './accounts'

export type AccountSyncRunItem = {
  accountId: number
  email?: string
  displayName?: string | null
  accountLabel?: string | null
  ok?: boolean
  skipped?: boolean
  error?: string
  status?: AccountStatus
  connectionStatus?: AccountConnectionStatus
}

export type SyncAllRunResult = {
  mode?: SyncMode | null
  accounts: AccountSyncRunItem[]
}

export type AccountSyncRunResult = AccountSyncRunItem & {
  scannedCount?: number
  insertedCount?: number
  updatedCount?: number
}

export type SyncProgressEvent = {
  accountId: number
  completed?: number
  total?: number
  ok?: boolean
  skipped?: boolean
  stage?: 'connecting' | 'requesting' | 'folder' | 'fetching' | 'saving'
  folder?: string | null
  error?: string | null
}

export type MailboxChangedEvent = {
  accountId: number
  reason: 'idle' | 'poll' | 'manual'
  changedAt: string
}

export type NewMailNotificationMessage = {
  messageId: number
  accountId: number
  subject?: string
  fromName?: string
  fromEmail?: string
  receivedAt?: string
  snippet?: string
  verificationCode?: string
}

export type NewMailNotification = {
  notificationId: string
  accountId: number
  accountEmail?: string
  accountLabel?: string
  reason: MailboxChangedEvent['reason']
  messageCount: number
  messages: NewMailNotificationMessage[]
  notifiedAt: string
}

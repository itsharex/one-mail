import type { Account } from '@renderer/components/mail/types'

export function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message
  if (typeof error === 'string' && error.trim()) return error
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  return fallback
}

export function getNextSelectedAccountId(
  accounts: Account[],
  removedAccountId: string,
  currentAccountId: string
): string {
  if (accounts.length === 0) return ''
  if (
    currentAccountId !== removedAccountId &&
    accounts.some((account) => account.id === currentAccountId)
  ) {
    return currentAccountId
  }
  return accounts.find((account) => account.id === 'all')?.id ?? accounts[0]?.id ?? ''
}

export function getFallbackAccount(): Account {
  return {
    id: '',
    name: '',
    address: '',
    unread: 0,
    messageCount: 0,
    status: 'empty',
    accent: 'bg-primary'
  }
}

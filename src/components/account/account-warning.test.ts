import { describe, expect, it } from 'vitest'

import type { Account } from '@renderer/components/mail/types'
import type { TranslationKey } from '@renderer/lib/i18n'
import { getAccountWarning } from './account-warning'

const translate = (key: TranslationKey): string => key

function createAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 'account-1',
    accountId: 1,
    providerKey: 'outlook',
    authType: 'oauth2',
    name: 'owner@example.com',
    address: 'owner@example.com',
    unread: 0,
    status: 'active',
    connectionStatus: 'connected',
    credentialState: 'stored',
    accent: 'blue',
    ...overrides
  }
}

describe('getAccountWarning', () => {
  it('keeps credential failures actionable when a stale sync state remains', () => {
    const warning = getAccountWarning(
      createAccount({ status: 'syncing', connectionStatus: 'renewing', credentialState: 'invalid' }),
      translate
    )

    expect(warning?.primaryAction).toBe('reauthorize')
  })

  it('keeps an ordinary syncing account quiet', () => {
    expect(getAccountWarning(createAccount({ status: 'syncing' }), translate)).toBeNull()
  })

  it('keeps an active connected account usable when a transient error remains', () => {
    expect(getAccountWarning(createAccount({
      status: 'active',
      connectionStatus: 'connected',
      lastError: 'Temporary token refresh failed'
    }), translate)).toBeNull()
    expect(getAccountWarning(createAccount({
      status: 'active',
      connectionStatus: 'connected',
      lastError: 'OAuth access token request temporarily failed'
    }), translate)).toBeNull()
  })

  it('offers manual reauthorization without treating an interrupted OAuth sync as expired authorization', () => {
    const warning = getAccountWarning(createAccount({
      status: 'sync_error',
      lastError: '上次同步意外中断，请重新刷新。'
    }), translate)

    expect(warning?.title).toBe('account.warning.syncTitle')
    expect(warning?.primaryAction).toBe('retry')
    expect(warning?.secondaryAction).toBe('reauthorize')
    expect(warning?.steps).toContain('account.warning.syncOAuthStep2')
  })

  it('does not suggest reauthorization when Outlook accepted login but refused IMAP access', () => {
    const warning = getAccountWarning(createAccount({
      status: 'sync_error',
      lastError: 'AUTHENTICATE failed: User is authenticated but not connected'
    }), translate)

    expect(warning?.title).toBe('account.outlookImapHelp.title')
    expect(warning?.primaryAction).toBe('retry')
    expect(warning?.secondaryAction).toBeUndefined()
  })
})

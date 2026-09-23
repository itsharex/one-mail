import { describe, expect, it } from 'vitest'
import type { TranslationKey } from '@renderer/lib/i18n'
import { getSyncErrorPresentation } from './sync-error-presentation'

const t = (key: TranslationKey): string => key

describe('getSyncErrorPresentation', () => {
  it('suggests reauthorization for an expired Microsoft grant without showing diagnostic IDs', () => {
    const error = 'microsoft OAuth 返回 invalid_grant: AADSTS70000: The user could not be authenticated as the grant is expired. The user must sign in again. Trace ID: abc Correlation ID: def'
    expect(getSyncErrorPresentation(error, t)).toEqual({
      reason: 'sync.errorAuthorizationExpired',
      suggestion: 'sync.suggestionReauthorize'
    })
  })

  it('removes diagnostic IDs from other errors', () => {
    expect(getSyncErrorPresentation('user@example.com 同步失败：服务器拒绝连接 Trace ID: abc', t)).toEqual({
      reason: '服务器拒绝连接',
      suggestion: 'sync.suggestionGeneric'
    })
  })
})

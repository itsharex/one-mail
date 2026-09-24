import { describe, expect, it } from 'vitest'

import { translate } from '@renderer/lib/i18n'
import { createAccountSchema, defaultAccountFormValues } from './account-form-types'

const schema = createAccountSchema((key) => translate('zh-CN', key))

describe('add account validation', () => {
  it('allows Gmail OAuth without an email but rejects a malformed login hint', () => {
    expect(schema.safeParse(defaultAccountFormValues).success).toBe(true)

    const result = schema.safeParse({ ...defaultAccountFormValues, email: 'not-an-email' })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues.map((issue) => issue.path)).toContainEqual(['email'])
  })

  it('requires a valid email and password for app password login', () => {
    const result = schema.safeParse({ ...defaultAccountFormValues, authType: 'app_password' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path)).toEqual(
        expect.arrayContaining([['email'], ['password']])
      )
    }

    expect(
      schema.safeParse({
        ...defaultAccountFormValues,
        authType: 'app_password',
        email: 'person@gmail.com',
        password: 'abcd efgh'
      }).success
    ).toBe(true)
  })

  it('validates custom IMAP and only requires SMTP host when sending is enabled', () => {
    const custom = {
      ...defaultAccountFormValues,
      kind: 'custom' as const,
      authType: 'manual' as const,
      providerKey: 'custom_imap',
      email: 'person@example.com',
      password: 'secret',
      imapHost: '',
      smtpHost: ''
    }

    const enabled = schema.safeParse(custom)
    expect(enabled.success).toBe(false)
    if (!enabled.success) {
      expect(enabled.error.issues.map((issue) => issue.path)).toEqual(
        expect.arrayContaining([['imapHost'], ['smtpHost']])
      )
    }

    const disabled = schema.safeParse({ ...custom, smtpEnabled: false })
    expect(disabled.success).toBe(false)
    if (!disabled.success) {
      expect(disabled.error.issues.map((issue) => issue.path)).toContainEqual(['imapHost'])
      expect(disabled.error.issues.map((issue) => issue.path)).not.toContainEqual(['smtpHost'])
    }
  })
})

import { describe, expect, it } from 'vitest'

import type { NewMailNotification } from '@renderer/shared/types'
import { buildNewMailNotificationOptions } from './system-notifications'

const copy = {
  title: '新邮件',
  countTitle: '2 封新邮件',
  noSubject: '无主题',
  unknownSender: '未知发件人'
}

function notification(
  overrides: Partial<NewMailNotification> = {}
): NewMailNotification {
  return {
    notificationId: 'notification-1',
    accountId: 1,
    reason: 'manual',
    messageCount: 1,
    messages: [
      {
        messageId: 10,
        accountId: 1,
        subject: '季度报告',
        fromName: '测试发件人',
        fromEmail: 'sender@example.com'
      }
    ],
    notifiedAt: '2026-08-10T00:00:00.000Z',
    ...overrides
  }
}

describe('new-mail system notifications', () => {
  it('uses sender and subject with a macOS system sound for one message', () => {
    expect(buildNewMailNotificationOptions(notification(), copy, 'macos')).toMatchObject({
      title: '测试发件人',
      body: '季度报告',
      sound: 'Ping'
    })
  })

  it('groups multiple messages without requiring a custom Windows sound file', () => {
    const options = buildNewMailNotificationOptions(
      notification({
        messageCount: 2,
        messages: [
          { messageId: 10, accountId: 1, subject: '第一封', fromName: '发件人 A' },
          { messageId: 11, accountId: 1, subject: '第二封', fromEmail: 'b@example.com' }
        ]
      }),
      copy,
      'windows'
    )

    expect(options.title).toBe('2 封新邮件')
    expect(options.body).toContain('发件人 A')
    expect(options.sound).toBeUndefined()
  })
})

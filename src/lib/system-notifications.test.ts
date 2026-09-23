import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { describe, expect, it, vi } from 'vitest'

import type { NewMailNotification } from '@renderer/shared/types'
import { buildNewMailNotificationOptions, onSystemNotificationOpen, showNewMailSystemNotification, showSyncCompleteSystemNotification } from './system-notifications'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }))

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
      sound: 'Ping',
      messageId: 10
    })
  })

  it('groups multiple messages and targets the newest mail with the Windows mail sound', () => {
    const options = buildNewMailNotificationOptions(
      notification({
        messageCount: 2,
        messages: [
          { messageId: 10, accountId: 1, subject: '第一封', fromName: '发件人 A', receivedAt: '2026-08-10T00:00:00Z' },
          { messageId: 11, accountId: 1, subject: '第二封', fromEmail: 'b@example.com', receivedAt: '2026-08-10T00:01:00Z' }
        ]
      }),
      copy,
      'windows'
    )

    expect(options.title).toBe('2 封新邮件')
    expect(options.body).toContain('发件人 A')
    expect(options.sound).toBe('Mail')
    expect(options.messageId).toBe(11)
  })

  it('passes the provider icon key and exact message ID to the native sender', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined)
    await showNewMailSystemNotification(notification(), copy, 'macos', 'gmail')
    expect(invoke).toHaveBeenCalledWith('system_send_notification', expect.objectContaining({
      messageId: 10,
      providerKey: 'gmail',
      sound: 'Ping'
    }))
  })
})

it('reports a native notification delivery failure', async () => {
  vi.mocked(invoke).mockRejectedValueOnce(new Error('delivery denied'))
  await expect(showSyncCompleteSystemNotification('同步完成', '账号已同步')).rejects.toThrow('delivery denied')
})

it('forwards a clicked notification message to the mailbox', async () => {
  let receive: ((event: { payload: number }) => void) | undefined
  vi.mocked(listen).mockImplementationOnce((_name, callback) => {
    receive = callback as typeof receive
    return Promise.resolve(() => {})
  })
  vi.mocked(invoke).mockResolvedValueOnce(null)
  const onOpen = vi.fn()
  const stop = onSystemNotificationOpen(onOpen)
  await vi.waitFor(() => expect(receive).toBeDefined())
  receive?.({ payload: 42 })
  expect(onOpen).toHaveBeenCalledWith(42)
  stop()
})

import { describe, expect, it, vi } from 'vitest'

import { loadInitialData, toSharedSendInput, toUiComposeDraft } from './api'

describe('conversation workspace startup', () => {
  it('loads account metadata without requesting the retired message list', async () => {
    const listMessages = vi.fn().mockRejectedValue(new Error('The legacy list must not load'))
    vi.stubGlobal('window', { api: {
      accounts: { list: async () => [{ accountId: 1, email: 'owner@example.com', syncEnabled: true }] },
      messages: { stats: async () => [{ accountId: 1, unreadCount: 2, totalCount: 12 }], list: listMessages },
      settings: { get: async () => ({ locale: 'zh-CN', bodyDisplayMode: 'text' }) },
      system: { info: async () => ({ platform: 'darwin' }) }
    } })
    try {
      const result = await loadInitialData()
      expect(result.selectedAccountId).toBe('1')
      expect(result.accounts[0]).toMatchObject({ accountId: 1, unread: 2, messageCount: 12 })
      expect(listMessages).not.toHaveBeenCalled()
    } finally { vi.unstubAllGlobals() }
  })
})

describe('compose API mapping', () => {
  it('maps forward attachment candidates into selectable source attachments', () => {
    const draft = toUiComposeDraft({
      accountId: 1,
      mode: 'forward',
      relatedMessageId: 10,
      to: [],
      cc: [],
      bcc: [],
      subject: 'Fwd: report',
      bodyText: 'body',
      forwardAttachments: [
        {
          attachmentId: 20,
          filename: 'report.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 2048,
          selected: false
        }
      ]
    })

    expect(draft.forwardAttachments).toEqual([
      {
        sourceMessageId: 10,
        sourceAttachmentId: 20,
        filename: 'report.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048
      }
    ])
  })

  it('preserves forwarded attachment source ids when sending', () => {
    const input = toSharedSendInput({
      kind: 'forward',
      accountId: 1,
      relatedMessageId: 10,
      to: ['recipient@example.com'],
      subject: 'Fwd: report',
      bodyText: 'body',
      attachments: [
        {
          sourceMessageId: 10,
          sourceAttachmentId: 20,
          filename: 'report.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 2048
        }
      ]
    })

    expect(input.attachments).toEqual([
      {
        sourceMessageId: 10,
        sourceAttachmentId: 20,
        filename: 'report.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048
      }
    ])
  })

  it('falls back to attachmentPaths for legacy local-file sends', () => {
    const input = toSharedSendInput({
      kind: 'new',
      accountId: 1,
      to: ['recipient@example.com'],
      subject: 'Local file',
      bodyText: 'body',
      attachmentPaths: ['/tmp/report.pdf']
    })

    expect(input.attachments).toEqual([{ filePath: '/tmp/report.pdf' }])
  })
})

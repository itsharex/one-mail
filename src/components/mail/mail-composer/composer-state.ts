import type { ComposeDraft } from '@renderer/pages/mailbox/api'
import type { MailAttachmentInput } from '@renderer/shared/types'
import { textToHtml } from './editor-utils'

export type ComposerFormState = {
  draftKey: string
  accountId: string
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  bodyText: string
  bodyHtml: string
  attachments: MailAttachmentInput[]
  error: string | null
}

export function getDraftKey(draft: ComposeDraft | null): string {
  if (!draft) return 'empty'
  return [
    draft.draftId ?? 'local',
    draft.kind,
    draft.accountId,
    draft.relatedMessageId ?? 'new'
  ].join(':')
}

export function createFormState(draft: ComposeDraft | null, draftKey: string): ComposerFormState {
  return {
    draftKey,
    accountId: draft ? String(draft.accountId) : '',
    to: draft?.to ?? [],
    cc: draft?.cc ?? [],
    bcc: draft?.bcc ?? [],
    subject: draft?.subject ?? '',
    bodyText: draft?.bodyText ?? '',
    bodyHtml: draft?.bodyHtml ?? textToHtml(draft?.bodyText ?? ''),
    attachments: draft?.attachments ?? [],
    error: null
  }
}

export function resolveFormPatch(
  current: ComposerFormState,
  draft: ComposeDraft | null,
  draftKey: string,
  patch:
    | Partial<Omit<ComposerFormState, 'draftKey'>>
    | ((
        current: Omit<ComposerFormState, 'draftKey'>
      ) => Partial<Omit<ComposerFormState, 'draftKey'>>)
): ComposerFormState {
  const base = current.draftKey === draftKey ? current : createFormState(draft, draftKey)
  const nextPatch = typeof patch === 'function' ? patch(base) : patch
  return {
    ...base,
    ...nextPatch
  }
}

export function getAttachmentKey(attachment: MailAttachmentInput): string {
  return attachment.sourceAttachmentId
    ? `source:${attachment.sourceMessageId ?? ''}:${attachment.sourceAttachmentId}`
    : (attachment.filePath ?? attachment.filename ?? '')
}

export function getUnselectedForwardAttachments(
  draft: ComposeDraft | null,
  selectedAttachments: MailAttachmentInput[]
): MailAttachmentInput[] {
  const selectedKeys = new Set(selectedAttachments.map(getAttachmentKey))
  return (draft?.forwardAttachments ?? []).filter(
    (attachment) => !selectedKeys.has(getAttachmentKey(attachment))
  )
}

export function normalizeComposerHtml(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed && trimmed !== '<p></p>' ? trimmed : undefined
}

export function hasDraftContent(form: ComposerFormState): boolean {
  return (
    form.to.length > 0 ||
    form.cc.length > 0 ||
    form.bcc.length > 0 ||
    Boolean(form.subject.trim()) ||
    Boolean(form.bodyText.trim()) ||
    Boolean(normalizeComposerHtml(form.bodyHtml)) ||
    form.attachments.length > 0
  )
}

export function formatAttachmentTotal(attachments: MailAttachmentInput[]): string {
  const total = attachments.reduce((sum, attachment) => sum + (attachment.sizeBytes ?? 0), 0)
  return formatBytes(total, '')
}

export function formatBytes(value?: number, fallback = ''): string {
  if (!value) return fallback
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

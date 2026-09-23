import { useEffect, useMemo, useState } from 'react'
import { Image, ImageOff, Loader2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { ImageLoadWarningDialog } from '../image-load-warning-dialog'
import { prepareMailHtml } from '@renderer/components/mail/mail-html'
import { formatAbsoluteTime } from '@renderer/components/mail/date-format'
import type { ConversationMessage } from '@renderer/shared/conversations'
import type { MailMessageDetail } from '@renderer/shared/types'

export function OriginalMessageView({ message, text }: {
  message: ConversationMessage
  text: (cn: string, en: string) => string
}) {
  const [detail, setDetail] = useState<MailMessageDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [loadImages, setLoadImages] = useState(false)
  const [imageWarningOpen, setImageWarningOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    setDetail(null)
    setError('')
    setLoadImages(false)
    setImageWarningOpen(false)
    if (!message.messageId) { setLoading(false); return }
    setLoading(true)
    void (async () => {
      const current = await window.api.messages.get(message.messageId!)
      if (!current) throw new Error(text('邮件已不存在', 'Message no longer available'))
      if (!current.body) {
        const loaded = await window.api.messages.loadBody(message.messageId!)
        if (loaded.error) throw new Error(loaded.error)
        current.body = loaded.body ?? undefined
      }
      if (!cancelled) setDetail(current)
    })().catch((reason: unknown) => {
      if (!cancelled) setError(String(reason))
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [message.id, message.messageId])

  const html = detail?.body?.bodyHtmlSanitized ?? message.bodyHtmlSanitized ?? ''
  const blockedHtml = useMemo(() => html ? prepareMailHtml(html, { allowExternalImages: false }) : null, [html])
  const allowedHtml = useMemo(() => html && loadImages ? prepareMailHtml(html, { allowExternalImages: true }).html : '', [html, loadImages])
  const hasExternalImages = (blockedHtml?.blockedImageResourceCount ?? 0) > 0
  const body = detail?.body?.bodyText ?? message.bodyText ?? message.snippet
  const from = [detail?.fromName ?? message.fromName, detail?.fromEmail ?? message.fromEmail].filter(Boolean).join(' · ')
  const recipients = (addresses: ConversationMessage['to']) => addresses.map((address) =>
    address.name ? `${address.name} <${address.email}>` : address.email
  ).join(', ')

  return <>
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b bg-background px-6 py-4">
        <div className="flex items-start justify-between gap-4">
          <h2 className="min-w-0 break-words text-base font-semibold leading-6">{detail?.subject ?? message.subject ?? text('无主题', 'No subject')}</h2>
          {hasExternalImages && <Button type="button" variant="outline" size="sm" className="h-8 shrink-0" aria-pressed={loadImages} onClick={() => loadImages ? setLoadImages(false) : setImageWarningOpen(true)}>
            {loadImages ? <ImageOff className="size-4" /> : <Image className="size-4" />}
            {text(loadImages ? '隐藏图片' : '加载图片', loadImages ? 'Hide images' : 'Load images')}
          </Button>}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs leading-5">
          <p className="break-all"><span className="text-muted-foreground">{text('发件人', 'From')}：</span>{from || '—'}</p>
          <p className="break-all"><span className="text-muted-foreground">{text('收件人', 'To')}：</span>{detail?.to || recipients(message.to) || '—'}</p>
          {(detail?.cc || message.cc.length > 0) && <p className="break-all"><span className="text-muted-foreground">{text('抄送', 'Cc')}：</span>{detail?.cc || recipients(message.cc)}</p>}
          <p><span className="text-muted-foreground">{text('时间', 'Date')}：</span>{formatAbsoluteTime(detail?.receivedAt ?? message.receivedAt)}</p>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-6 py-5 [scrollbar-gutter:stable]">
        {loading && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{text('加载中…', 'Loading…')}</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {!loading && (html
          ? <div className="mail-html conversation-html text-sm" onClick={(event) => { if ((event.target as Element).closest('a')) event.preventDefault() }} dangerouslySetInnerHTML={{ __html: loadImages ? allowedHtml : blockedHtml?.html ?? '' }} />
          : <div className="whitespace-pre-wrap break-words text-sm leading-6">{body || text('无正文', 'No message body')}</div>)}
        {detail?.attachments.length ? <div className="mt-5 border-t pt-3 text-sm">
          <p className="mb-2 font-medium">{text('附件', 'Attachments')}</p>
          <ul className="list-inside list-disc space-y-1 break-all text-muted-foreground">
            {detail.attachments.map((attachment) => <li key={attachment.attachmentId}>{attachment.filename}</li>)}
          </ul>
        </div> : null}
      </div>
    </div>
    <ImageLoadWarningDialog open={imageWarningOpen} onOpenChange={setImageWarningOpen} onConfirm={() => setLoadImages(true)} text={text} />
  </>
}

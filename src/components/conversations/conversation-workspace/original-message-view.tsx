import { useEffect, useMemo, useState } from 'react'
import { Image, ImageOff, Loader2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { ImageLoadWarningDialog } from '../image-load-warning-dialog'
import { prepareMailHtml } from '@renderer/components/mail/mail-html'
import { formatBytes } from '@renderer/components/mail/mail-composer/composer-state'
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
  const originalSize = formatBytes(detail?.sizeBytes, text('未知', 'Unknown'))
  const imageActionLabel = text(loadImages ? '隐藏图片' : '加载图片', loadImages ? 'Hide images' : 'Load images')

  return <>
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-3 border-b bg-background px-5 py-2.5">
        <span className="text-xs text-muted-foreground">{text('原始邮件大小', 'Original size')}：{originalSize}</span>
        {hasExternalImages && <Button type="button" variant="ghost" size="icon-sm" className="ml-auto shrink-0 text-muted-foreground" aria-label={imageActionLabel} title={imageActionLabel} aria-pressed={loadImages} onClick={() => loadImages ? setLoadImages(false) : setImageWarningOpen(true)}>
          {loadImages ? <ImageOff className="size-4" /> : <Image className="size-4" />}
        </Button>}
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-5 py-4 [scrollbar-gutter:stable]">
        {loading && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{text('加载中…', 'Loading…')}</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {!loading && (html
          ? <div className="mail-html original-message-html text-sm" onClick={(event) => { if ((event.target as Element).closest('a')) event.preventDefault() }} dangerouslySetInnerHTML={{ __html: loadImages ? allowedHtml : blockedHtml?.html ?? '' }} />
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

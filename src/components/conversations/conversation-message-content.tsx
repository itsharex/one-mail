import { useCallback, useEffect, useId, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { ChevronDown, ChevronUp, Loader2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { prepareMailHtml } from '@renderer/components/mail/mail-html'
import { conversationHtmlToText, conversationLinkUrl, conversationTextParts, type ConversationTextLink } from './conversation-text'
import { openExternalUrl } from '@renderer/lib/api'
import { toast } from 'sonner'
import { useI18n } from '@renderer/lib/i18n'
import type { ConversationMessage } from '@renderer/shared/conversations'
import type { AppSettings } from '@renderer/shared/types'
import { compactMailBodyText } from '@renderer/shared/mail-text'

const COLLAPSED_HEIGHT = 240

export function ConversationMessageContent({ message, refresh, bodyDisplayMode, externalImagesBlocked, children }: {
  message: ConversationMessage
  refresh: () => void
  bodyDisplayMode: AppSettings['bodyDisplayMode']
  externalImagesBlocked: boolean
  children: ReactNode
}) {
  const { locale } = useI18n()
  const text = (cn: string, en: string) => locale === 'zh-CN' ? cn : en
  const [loadedBody, setLoadedBody] = useState<{
    bodyText?: string | null
    bodyHtmlSanitized?: string | null
  } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)
  const [imagesAllowed, setImagesAllowed] = useState(false)
  const container = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const marking = useRef(false)
  const loadingBody = useRef(false)
  const autoLoadAttempted = useRef(false)
  const contentId = useId()
  const html = loadedBody?.bodyHtmlSanitized ?? message.bodyHtmlSanitized ?? ''
  const plainText = loadedBody?.bodyText ?? message.bodyText
  const { body, links } = useMemo(() => {
    const links: ConversationTextLink[] = []
    return { body: (html ? conversationHtmlToText(html, links) : '') || plainText || '', links }
  }, [plainText, html])
  const hasBody = loadedBody !== null || Boolean(body || html)
  const allowImages = !externalImagesBlocked || imagesAllowed
  const prepared = useMemo(() => bodyDisplayMode === 'html' && html
    ? prepareMailHtml(html, { allowExternalImages: allowImages })
    : null, [bodyDisplayMode, html, allowImages])

  useEffect(() => {
    setImagesAllowed(false)
  }, [externalImagesBlocked])

  useEffect(() => {
    const element = content.current
    if (!element) return
    const measure = () => setOverflowing(element.scrollHeight > COLLAPSED_HEIGHT)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!hasBody || message.isRead || !message.messageId || !container.current) return
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting) || marking.current) return
      marking.current = true
      void window.api.messages.setReadState(message.messageId!, true).then(refresh).catch(() => { marking.current = false })
      observer.disconnect()
    }, { threshold: 0.1 })
    observer.observe(container.current)
    return () => observer.disconnect()
  }, [hasBody, message.messageId, message.isRead, refresh])

  const load = useCallback(async () => {
    if (!message.messageId || hasBody || loadingBody.current) return
    loadingBody.current = true
    setLoading(true); setError('')
    try {
      const detail = await window.api.messages.get(message.messageId)
      const result = detail?.body ?? (await window.api.messages.loadBody(message.messageId)).body
      if (!result) throw new Error(locale === 'zh-CN' ? '正文加载失败，请重试' : 'Could not load the message. Try again.')
      setLoadedBody(result)
      refresh()
    } catch (reason) { setError(String(reason)) } finally { loadingBody.current = false; setLoading(false) }
  }, [message.messageId, hasBody, locale, refresh])

  useEffect(() => {
    if (hasBody || !message.messageId || autoLoadAttempted.current || !container.current) return
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting) || autoLoadAttempted.current) return
      autoLoadAttempted.current = true
      observer.disconnect()
      void load()
    })
    observer.observe(container.current)
    return () => observer.disconnect()
  }, [hasBody, message.messageId, load])

  async function openLink(event: MouseEvent<HTMLDivElement>) {
    const anchor = (event.target as Element).closest('a')
    if (!anchor || event.button > 1) return
    event.preventDefault()
    const href = conversationLinkUrl(anchor.getAttribute('href') || '')
    if (!href) return
    try {
      if (!await openExternalUrl(href)) throw new Error('Could not open link')
    } catch { toast.error(text('无法打开链接，请稍后重试', 'Could not open the link. Try again.')) }
  }

  return <div ref={container} className="min-w-0" aria-busy={loading}>
    <div id={contentId} className="overflow-hidden" style={{ maxHeight: expanded ? undefined : COLLAPSED_HEIGHT, maskImage: overflowing && !expanded ? 'linear-gradient(to bottom, black calc(100% - 24px), transparent)' : undefined }}>
      <div ref={content} className="flow-root" onClick={openLink} onAuxClick={openLink}>
        {prepared ? <div className="mail-html conversation-html text-sm" dangerouslySetInnerHTML={{ __html: prepared.html }} /> : <MessageText value={body || message.snippet || text(hasBody ? '（无文本内容）' : '正文尚未加载', hasBody ? '(No text content)' : 'Message body has not been loaded')} links={links} quoteLabel={text('展开引用与签名', 'Show quoted text and signature')} />}
      </div>
    </div>
    {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
    {overflowing && <Button variant="ghost" size="sm" className="h-6 px-1 text-xs" aria-expanded={expanded} aria-controls={contentId} onClick={() => setExpanded(!expanded)}>
      {expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}{text(expanded ? '收起正文' : '展开全文', expanded ? 'Collapse message' : 'Show full message')}
    </Button>}
    {prepared && !allowImages && prepared.blockedImageResourceCount > 0 && <Button className="h-6 px-1 text-xs" size="sm" variant="ghost" onClick={() => setImagesAllowed(true)}>{text('加载本条图片', 'Load images for this message')}</Button>}
    {loading && <span role="status" className="inline-flex h-6 items-center gap-1 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" aria-hidden="true" />{text('加载中…', 'Loading…')}</span>}
    {!hasBody && error && !loading && <Button className="h-6 px-1 text-xs" size="sm" variant="ghost" onClick={() => void load()}>{text('重试加载', 'Retry loading')}</Button>}
    {children}
    </div>
  </div>
}

function MessageText({ value, links, quoteLabel }: { value: string; links: ConversationTextLink[]; quoteLabel: string }) {
  const compactText = compactMailBodyText(value)
  const lines = compactText.split('\n')
  const quoteIndex = lines.findIndex((line, index) => index > 0 && (/^\s*>/.test(line) || /^On .+wrote:\s*$/.test(line) || /^-- ?$/.test(line) || /^[-_]{3,}.*(Original Message|原始邮件)/i.test(line)))
  const visible = quoteIndex > 0 ? lines.slice(0, quoteIndex).join('\n').trimEnd() : compactText
  return <>
    <div className="space-y-1.5 break-words text-sm leading-5 [overflow-wrap:anywhere]">
      {visible.split('\n\n').map((paragraph, index) => <p key={index} className="whitespace-pre-line"><LinkedText value={paragraph.trim()} links={links} /></p>)}
    </div>
    {quoteIndex > 0 && <details className="mt-2 text-xs leading-4 text-muted-foreground"><summary className="cursor-pointer">{quoteLabel}</summary><p className="mt-1.5 whitespace-pre-line break-words [overflow-wrap:anywhere]"><LinkedText value={lines.slice(quoteIndex).join('\n')} links={links} /></p></details>}
  </>
}

function LinkedText({ value, links }: { value: string; links: ConversationTextLink[] }) {
  return conversationTextParts(value, links).map((part, index) => part.href
    ? <a key={index} href={part.href} title={part.href} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline decoration-blue-600/40 underline-offset-2 hover:decoration-current focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring dark:text-blue-400">{part.text}</a>
    : part.text)
}

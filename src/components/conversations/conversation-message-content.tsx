import { useCallback, useEffect, useId, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { ChevronDown, ChevronUp, RotateCw } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Skeleton } from '@renderer/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { prepareMailHtml } from '@renderer/components/mail/mail-html'
import {
  conversationHtmlToText,
  conversationLinkUrl,
  conversationTextParts,
  type ConversationTextLink,
} from './conversation-text'
import { openExternalUrl } from '@renderer/lib/api'
import { toast } from 'sonner'
import { useI18n } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import type { ConversationMessage } from '@renderer/shared/conversations'
import type { AppSettings } from '@renderer/shared/types'
import { compactMailBodyText } from '@renderer/shared/mail-text'

const COLLAPSED_HEIGHT = 240

export function ConversationMessageContent({ message, refresh, bodyDisplayMode, children }: {
  message: ConversationMessage
  refresh: () => void
  bodyDisplayMode: AppSettings['bodyDisplayMode']
  children: (copyBody: string | null) => ReactNode
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
  const copyBody = useMemo(() => plainText?.trim() ? plainText : (html ? conversationHtmlToText(html) : null), [plainText, html])
  const hasBody = loadedBody !== null || Boolean(body || html)
  const showBodySkeleton = !hasBody && Boolean(message.messageId) && !error
  const showHtml = bodyDisplayMode === 'html'
  const prepared = useMemo(() => html && showHtml
    ? prepareMailHtml(html, { allowExternalImages: false })
    : null, [html, showHtml])

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
      void window.api.messages.setReadState(message.messageId!, true)
        .then((update) => {
          observer.disconnect()
          refresh()
          if (update.remoteSynced === false) toast.warning(text('仅在本机标为已读；此 API 账号暂不支持写回远端', 'Marked read only on this device; this API account cannot update the server yet'))
        })
        .catch((reason) => { marking.current = false; toast.error(String(reason)) })
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

  return <div ref={container} className="min-w-0 max-w-full" aria-busy={loading}>
    <div className={cn('conversation-bubble relative max-w-full rounded px-3 py-2.5', showBodySkeleton ? 'w-80' : 'w-fit', message.direction === 'outgoing' && 'is-outgoing ml-auto')}>
      <div id={contentId} className={expanded ? undefined : 'overflow-hidden'} style={{ maxHeight: expanded ? undefined : COLLAPSED_HEIGHT, maskImage: overflowing && !expanded ? 'linear-gradient(to bottom, black calc(100% - 24px), transparent)' : undefined }}>
        <div ref={content} className="flow-root" onClick={openLink} onAuxClick={openLink}>
          {showBodySkeleton ? <div role="status" aria-label={text('加载邮件中', 'Loading message')} className="space-y-2 py-1">
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="mt-4 h-4 w-2/3" />
          </div> : showHtml && prepared ? <div className="mail-html conversation-html text-sm" dangerouslySetInnerHTML={{ __html: prepared.html }} /> : <MessageText value={body || message.snippet || text(hasBody ? '（无文本内容）' : '正文尚未加载', hasBody ? '(No text content)' : 'Message body has not been loaded')} links={links} quoteLabel={text('展开引用与签名', 'Show quoted text and signature')} />}
        </div>
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
    <TooltipProvider>
      <div className="conversation-message-actions mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        {overflowing && <Tooltip>
          <TooltipTrigger asChild><Button variant="outline" size="icon-sm" aria-label={text(expanded ? '收起正文' : '展开全文', expanded ? 'Collapse message' : 'Show full message')} aria-expanded={expanded} aria-controls={contentId} onClick={() => setExpanded(!expanded)}>
            {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </Button></TooltipTrigger>
          <TooltipContent side="bottom">{text(expanded ? '收起正文' : '展开全文', expanded ? 'Collapse message' : 'Show full message')}</TooltipContent>
        </Tooltip>}
        {!hasBody && error && !loading && <Tooltip>
          <TooltipTrigger asChild><Button size="icon-sm" variant="outline" aria-label={text('重试加载', 'Retry loading')} onClick={() => void load()}><RotateCw className="size-4" /></Button></TooltipTrigger>
          <TooltipContent side="bottom">{text('重试加载', 'Retry loading')}</TooltipContent>
        </Tooltip>}
        {children(copyBody)}
      </div>
    </TooltipProvider>
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

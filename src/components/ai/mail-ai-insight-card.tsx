import * as React from 'react'
import { ArrowUp, FileText, RotateCcw, Sparkle, X } from 'lucide-react'

import { SweepShine } from '@renderer/components/sweep-shine'
import { Button } from '@renderer/components/ui/button'
import { useI18n } from '@renderer/lib/i18n'
import type { AiChatInput, AiChatMessage, AiChatResult, AiSettings } from '@renderer/shared/types'
import { AiMarkdown } from './ai-markdown'

export type MailAiInsightKind = 'summary' | 'tasks'

type MailAiInsightCardProps = {
  kind: MailAiInsightKind
  messageId: number
  subject: string
  settings: AiSettings
  onChat: (input: AiChatInput) => Promise<AiChatResult>
  onOpenOriginal: () => void
  onClose: () => void
}

export function MailAiInsightCard({
  kind,
  messageId,
  subject,
  settings,
  onChat,
  onOpenOriginal,
  onClose
}: MailAiInsightCardProps): React.JSX.Element {
  const { locale } = useI18n()
  const zh = locale === 'zh-CN'
  const text = (cn: string, en: string): string => zh ? cn : en
  const [messages, setMessages] = React.useState<AiChatMessage[]>([])
  const [question, setQuestion] = React.useState('')
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState('')
  const [truncated, setTruncated] = React.useState(false)
  const started = React.useRef(false)
  const requestId = React.useRef(0)
  const title = kind === 'summary' ? text('这封邮件的摘要', 'Message summary') : text('这封邮件的待办', 'Message action items')
  const initialPrompt = kind === 'summary'
    ? text('仅根据附加的这封邮件，简洁概括关键信息。无法确认的内容请明确说明。', 'Summarize only the attached message concisely. State what cannot be confirmed.')
    : text('仅根据附加的这封邮件，列出明确的待办、负责人和时间要求。未提及时写明“未提及”，不要推测。', 'List only explicit action items, owners, and deadlines in the attached message. Say when a detail is absent; do not infer it.')

  async function ask(prompt: string, history: AiChatMessage[]): Promise<void> {
    const requestMessages = [...history, { role: 'user' as const, content: prompt }]
    const currentRequest = ++requestId.current
    setMessages(requestMessages)
    setPending(true)
    setError('')
    try {
      const result = await onChat({ messageId, messages: requestMessages })
      if (requestId.current !== currentRequest) return
      setTruncated(result.contextTruncated === true)
      setMessages([...requestMessages, result.message])
    } catch (reason) {
      if (requestId.current !== currentRequest) return
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (requestId.current === currentRequest) setPending(false)
    }
  }

  React.useEffect(() => {
    if (started.current) return
    started.current = true
    void ask(initialPrompt, [])
  }, [])

  const lastMessage = messages.at(-1)
  const canRetry = !pending && lastMessage?.role === 'user'

  return (
    <section aria-label={title} className="ml-12 mb-5 max-w-[min(80%,48rem)] overflow-hidden rounded-xl border border-border/70 bg-card shadow-[0_5px_20px_rgb(0_0_0/0.06)] md:ml-12">
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-muted/60 text-foreground"><Sparkle className="size-4" strokeWidth={1.8} aria-hidden="true" /></span>
        <span className="min-w-0 flex-1 truncate text-xs font-semibold">{title}</span>
        <span className="max-w-28 truncate rounded-full border border-border/70 px-2 py-0.5 text-[10px] text-muted-foreground" title={`${settings.model} · ${serviceHost(settings.baseUrl)}`}>{settings.model}</span>
        <Button type="button" variant="ghost" size="icon-sm" className="size-6 shrink-0" aria-label={text('关闭 AI 结果', 'Close AI result')} onClick={onClose}><X className="size-3.5" /></Button>
      </div>
      <div className="space-y-3 px-3 py-3 text-[13px] leading-relaxed">
        {messages.map((message, index) => message.role === 'assistant'
          ? <AiMarkdown key={index}>{message.content}</AiMarkdown>
          : index > 0
            ? <p key={index} className="rounded-lg bg-muted/60 px-2.5 py-1.5 text-xs text-muted-foreground">{message.content}</p>
            : null)}
        {pending && <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><Sparkle className="size-3.5" aria-hidden="true" /><SweepShine>{text('正在阅读这封邮件…', 'Reading this message…')}</SweepShine></p>}
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        {canRetry && <Button type="button" variant="outline" size="sm" onClick={() => void ask(lastMessage.content, messages.slice(0, -1))}><RotateCcw className="size-3.5" />{text('重试', 'Retry')}</Button>}
        {truncated && <p className="text-xs text-amber-700 dark:text-amber-300">{text('邮件内容过长，AI 只读取了一部分。', 'The message was too long; AI read only part of it.')}</p>}
      </div>
      <div className="border-t border-border/60 bg-muted/20 px-3 py-2.5">
        <button type="button" className="mb-2 flex max-w-full items-center gap-1.5 rounded-full border border-border/70 bg-background px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground" onClick={onOpenOriginal} title={subject}>
          <FileText className="size-3 shrink-0" aria-hidden="true" /><span className="truncate">{subject || text('无主题邮件', 'Untitled message')}</span><span className="shrink-0">↗</span>
        </button>
        <form className="flex items-end gap-2 rounded-xl border border-border/70 bg-background p-1.5 shadow-sm" onSubmit={(event) => { event.preventDefault(); if (!question.trim() || pending) return; void ask(question.trim(), messages.slice(-18)); setQuestion('') }}>
          <input value={question} onChange={(event) => setQuestion(event.target.value)} disabled={pending} maxLength={2000} aria-label={text('继续询问这封邮件', 'Ask a follow-up about this message')} placeholder={text('继续询问这封邮件…', 'Ask about this message…')} className="min-w-0 flex-1 bg-transparent px-1.5 py-1 text-xs outline-none placeholder:text-muted-foreground" />
          <Button type="submit" size="icon-sm" className="size-7 rounded-lg" disabled={pending || !question.trim()} aria-label={text('发送问题', 'Send question')}><ArrowUp className="size-3.5" /></Button>
        </form>
        <p className="mt-1.5 text-[10px] text-muted-foreground">{text(`这封邮件的文本和你输入的问题会发送至 ${serviceHost(settings.baseUrl)}。`, `This message's text and your questions are sent to ${serviceHost(settings.baseUrl)}.`)}</p>
      </div>
    </section>
  )
}

function serviceHost(baseUrl: string): string {
  try { return new URL(baseUrl).host } catch { return baseUrl }
}

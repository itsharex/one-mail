import * as React from 'react'
import { ArrowUp, FileText, RotateCcw, Sparkle, X } from 'lucide-react'

import { SweepShine } from '@renderer/components/sweep-shine'
import { Button } from '@renderer/components/ui/button'
import { useI18n } from '@renderer/lib/i18n'
import type { ConversationMessage } from '@renderer/shared/conversations'
import type { AiChatInput, AiChatResult, AiSettings } from '@renderer/shared/types'

type WritingAction = 'draft' | 'polish' | 'shorten'

type AiWritingCardProps = {
  body: string
  setBody: (value: string) => void
  sourceMessage?: ConversationMessage
  newTopic: boolean
  settings: AiSettings
  onChat: (input: AiChatInput) => Promise<AiChatResult>
  onClose: () => void
}

export function AiWritingCard({ body, setBody, sourceMessage, newTopic, settings, onChat, onClose }: AiWritingCardProps): React.JSX.Element {
  const { locale } = useI18n()
  const zh = locale === 'zh-CN'
  const text = (cn: string, en: string): string => zh ? cn : en
  const [instruction, setInstruction] = React.useState('')
  const [result, setResult] = React.useState('')
  const [sourceBody, setSourceBody] = React.useState('')
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState('')
  const [truncated, setTruncated] = React.useState(false)
  const [lastAction, setLastAction] = React.useState<WritingAction | null>(null)
  const requestId = React.useRef(0)
  const draftChanged = Boolean(result) && body !== sourceBody
  const sourceId = newTopic ? undefined : sourceMessage?.messageId ?? undefined
  const host = serviceHost(settings.baseUrl)

  async function generate(action: WritingAction): Promise<void> {
    const currentBody = body.trim()
    const currentInstruction = instruction.trim()
    if (body.length > 6000) {
      setError(text('草稿超过 6000 字，请选取较短的内容。', 'The draft exceeds 6,000 characters. Select a shorter passage.'))
      return
    }
    if (action === 'draft' && !currentInstruction) {
      setError(text('先写下想表达的内容，再生成回复。', 'Describe what you want to say before drafting.'))
      return
    }
    if (action !== 'draft' && !currentBody) return

    const prompt = action === 'draft'
      ? text(
          `根据用户意图起草邮件正文。用户意图：${currentInstruction}\n${currentBody ? `用户已有草稿：\n${currentBody}\n` : ''}保留已知事实，不虚构日期、承诺或附件。只返回可编辑的邮件正文，不要发送。`,
          `Draft an email body from the user's intent: ${currentInstruction}\n${currentBody ? `Existing draft:\n${currentBody}\n` : ''}Preserve known facts. Do not invent dates, commitments, or attachments. Return only the editable email body; do not send it.`
        )
      : text(
          `${action === 'shorten' ? '缩短' : '润色'}下面这段用户写的邮件草稿，保留所有事实、日期、承诺和原意，不补充未知信息。${currentInstruction ? `额外要求：${currentInstruction}。` : ''}只返回修改后的邮件正文：\n${currentBody}`,
          `${action === 'shorten' ? 'Shorten' : 'Polish'} the user's email draft below while preserving every fact, date, commitment, and the original intent. Do not add unknown information.${currentInstruction ? ` Additional instruction: ${currentInstruction}.` : ''} Return only the revised email body:\n${currentBody}`
        )

    const currentRequest = ++requestId.current
    setSourceBody(body)
    setLastAction(action)
    setResult('')
    setError('')
    setPending(true)
    try {
      const response = await onChat({
        ...(sourceId ? { messageId: sourceId } : {}),
        messages: [{ role: 'user', content: prompt }]
      })
      if (requestId.current !== currentRequest) return
      setTruncated(response.contextTruncated === true)
      setResult(response.message.content.trim())
    } catch (reason) {
      if (requestId.current !== currentRequest) return
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (requestId.current === currentRequest) setPending(false)
    }
  }

  return (
    <section aria-label={text('AI 辅助写作', 'AI writing assistance')} className="mx-3 mb-2 max-h-[min(50dvh,28rem)] overflow-y-auto rounded-xl border border-border/70 bg-card shadow-[0_5px_20px_rgb(0_0_0/0.06)] md:mx-4">
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-muted/60 text-foreground"><Sparkle className="size-4" strokeWidth={1.8} aria-hidden="true" /></span>
        <strong className="min-w-0 flex-1 truncate text-xs font-semibold">{text('辅助写作', 'Writing assistance')}</strong>
        <span className="max-w-28 truncate rounded-full border border-border/70 px-2 py-0.5 text-[10px] text-muted-foreground" title={`${settings.model} · ${host}`}>{settings.model}</span>
        <Button type="button" variant="ghost" size="icon-sm" className="size-6 shrink-0" aria-label={text('关闭辅助写作', 'Close writing assistance')} onClick={onClose}><X className="size-3.5" /></Button>
      </div>
      <div className="space-y-2.5 px-3 py-3">
        {sourceId && <div className="flex max-w-full items-center gap-1.5 text-[11px] text-muted-foreground"><FileText className="size-3 shrink-0" /><span className="truncate">{text('参考邮件：', 'Using message: ')}{sourceMessage?.subject || text('无主题', 'Untitled')}</span></div>}
        <div className="flex flex-wrap gap-1.5">
          {!body.trim() && <Button type="button" size="sm" variant="outline" className="h-7 rounded-full px-3 text-xs" disabled={pending} onClick={() => void generate('draft')}>{text('起草回复', 'Draft reply')}</Button>}
          {body.trim() && <>
            <Button type="button" size="sm" variant="outline" className="h-7 rounded-full px-3 text-xs" disabled={pending} onClick={() => void generate('polish')}>{text('润色', 'Polish')}</Button>
            <Button type="button" size="sm" variant="outline" className="h-7 rounded-full px-3 text-xs" disabled={pending} onClick={() => void generate('shorten')}>{text('缩短', 'Shorten')}</Button>
          </>}
        </div>
        <form className="flex items-end gap-2 rounded-xl border border-border/70 bg-background p-1.5 shadow-sm" onSubmit={(event) => { event.preventDefault(); void generate(body.trim() ? 'polish' : 'draft') }}>
          <input value={instruction} onChange={(event) => setInstruction(event.target.value)} disabled={pending} maxLength={1000} aria-label={text('给 AI 的写作要求', 'Writing instruction for AI')} placeholder={body.trim() ? text('补充要求，例如更委婉…', 'Add an instruction, e.g. more tactful…') : text('先说想回复什么…', 'Describe what you want to say…')} className="min-w-0 flex-1 bg-transparent px-1.5 py-1 text-xs outline-none placeholder:text-muted-foreground" />
          <Button type="submit" size="icon-sm" className="size-7 rounded-lg" disabled={pending || (!body.trim() && !instruction.trim())} aria-label={text('生成建议', 'Generate suggestion')}><ArrowUp className="size-3.5" /></Button>
        </form>
        {pending && <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><Sparkle className="size-3.5" aria-hidden="true" /><SweepShine>{text('正在准备写作建议…', 'Preparing writing suggestion…')}</SweepShine></p>}
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        {result && <div className="overflow-hidden rounded-lg border border-border/70 bg-muted/20">
          <div className="border-b border-border/60 px-3 py-2 text-[11px] font-medium text-muted-foreground">{text('建议草稿 · 请审阅', 'Suggested draft · review before using')}</div>
          <p className="max-h-56 overflow-y-auto whitespace-pre-wrap break-words px-3 py-3 text-[13px] leading-relaxed">{result}</p>
          <div className="flex flex-wrap items-center justify-end gap-1.5 border-t border-border/60 px-2 py-2">
            {draftChanged && <span className="mr-auto text-[11px] text-amber-700 dark:text-amber-300">{text('回复框已变化，请重新生成。', 'Your draft changed. Generate again.')}</span>}
            <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setResult('')}>{text('丢弃', 'Discard')}</Button>
            {lastAction && <Button type="button" variant="ghost" size="icon-sm" className="size-7" disabled={pending} aria-label={text('重新生成', 'Regenerate')} onClick={() => void generate(lastAction)}><RotateCcw className="size-3.5" /></Button>}
            <Button type="button" size="sm" className="h-7 text-xs" disabled={Boolean(draftChanged) || pending} onClick={() => { setBody(result); onClose() }}>{sourceBody.trim() ? text('替换草稿', 'Replace draft') : text('插入回复', 'Insert into reply')}</Button>
          </div>
        </div>}
        {truncated && <p className="text-[11px] text-amber-700 dark:text-amber-300">{text('参考邮件内容过长，AI 只读取了一部分。', 'The reference message was too long; AI read only part of it.')}</p>}
        <p className="text-[10px] leading-relaxed text-muted-foreground">{text(`点击生成后，${sourceId ? '所选邮件和草稿' : '草稿'}将发送至 ${host}；AI 不会发送邮件。`, `When you generate, ${sourceId ? 'the selected message and your draft' : 'your draft'} go to ${host}. AI cannot send mail.`)}</p>
      </div>
    </section>
  )
}

function serviceHost(baseUrl: string): string {
  try { return new URL(baseUrl).host } catch { return baseUrl }
}

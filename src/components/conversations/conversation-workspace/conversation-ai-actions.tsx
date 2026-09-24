import { ListTodo, MoreHorizontal, Sparkle } from 'lucide-react'

import { MailAiInsightCard, type MailAiInsightKind } from '@renderer/components/ai/mail-ai-insight-card'
import { Button } from '@renderer/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@renderer/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { useI18n } from '@renderer/lib/i18n'
import type { ConversationMessage } from '@renderer/shared/conversations'
import type { AiChatInput, AiChatResult, AiSettings } from '@renderer/shared/types'

export type ConversationAiSelection = { messageId: number; kind: MailAiInsightKind; token: number }

export function ConversationAiMenu({ onSelect }: { onSelect: (kind: MailAiInsightKind) => void }) {
  const { locale } = useI18n()
  const zh = locale === 'zh-CN'
  return <DropdownMenu>
    <Tooltip>
      <TooltipTrigger asChild><DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="icon-sm" aria-label={zh ? '更多操作' : 'More actions'}><MoreHorizontal className="size-4" aria-hidden="true" /></Button>
      </DropdownMenuTrigger></TooltipTrigger>
      <TooltipContent side="bottom">{zh ? '更多操作' : 'More actions'}</TooltipContent>
    </Tooltip>
    <DropdownMenuContent align="start" className="min-w-44">
      <DropdownMenuItem onSelect={() => onSelect('summary')}><Sparkle aria-hidden="true" />{zh ? '总结这封邮件' : 'Summarize this message'}</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onSelect('tasks')}><ListTodo aria-hidden="true" />{zh ? '提取待办' : 'Extract action items'}</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
}

export function ConversationAiResult({ selection, message, settings, onChat, onOpenOriginal, onClose }: {
  selection: ConversationAiSelection | null
  message: ConversationMessage
  settings?: AiSettings
  onChat?: (input: AiChatInput) => Promise<AiChatResult>
  onOpenOriginal: () => void
  onClose: () => void
}) {
  if (!selection || !settings || !onChat || !message.messageId || selection.messageId !== message.messageId) return null
  return <MailAiInsightCard
    key={`${selection.token}:${selection.kind}`}
    kind={selection.kind}
    messageId={message.messageId}
    subject={message.subject || ''}
    settings={settings}
    onChat={onChat}
    onOpenOriginal={onOpenOriginal}
    onClose={onClose}
  />
}

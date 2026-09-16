import { Mail, RotateCcw, Send, Sparkles, X } from 'lucide-react'
import * as React from 'react'

import { SweepShine } from '@renderer/components/sweep-shine'
import { Button } from '@renderer/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@renderer/components/ui/tooltip'
import { useI18n } from '@renderer/lib/i18n'
import type {
  AiChatInput,
  AiChatMessage,
  AiChatResult,
  AiSettings
} from '@renderer/shared/types'

type AiAssistantProps = {
  settings: AiSettings
  launcherHidden?: boolean
  messageId?: number
  messageSubject?: string
  onChat: (input: AiChatInput) => Promise<AiChatResult>
}

export function AiAssistant({
  settings,
  launcherHidden = false,
  messageId,
  messageSubject,
  onChat
}: AiAssistantProps): React.JSX.Element {
  const { t } = useI18n()
  const [open, setOpen] = React.useState(false)
  const [messages, setMessages] = React.useState<AiChatMessage[]>([])
  const [draft, setDraft] = React.useState('')
  const [attachCurrentMessage, setAttachCurrentMessage] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const titleId = React.useId()
  const descriptionId = React.useId()
  const launcherRef = React.useRef<HTMLButtonElement | null>(null)
  const composerRef = React.useRef<HTMLTextAreaElement | null>(null)
  const messagesEndRef = React.useRef<HTMLDivElement | null>(null)
  const requestTokenRef = React.useRef(0)

  React.useEffect(() => {
    requestTokenRef.current += 1
    setMessages([])
    setDraft('')
    setAttachCurrentMessage(false)
    setPending(false)
    setError(null)
  }, [messageId, settings.baseUrl, settings.model, settings.verifiedAt])

  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: 'nearest' })
  }, [messages, pending])

  React.useEffect(() => {
    if (!open) return
    window.setTimeout(() => composerRef.current?.focus(), 0)

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') handleOpenChange(false)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open])

  async function sendMessage(
    content: string,
    includeCurrentMessage = attachCurrentMessage
  ): Promise<void> {
    const normalizedContent = content.trim()
    if (!normalizedContent || pending) return

    const requestToken = requestTokenRef.current + 1
    requestTokenRef.current = requestToken
    const userMessage: AiChatMessage = { role: 'user', content: normalizedContent }
    const requestMessages = [...messages, userMessage]
    setMessages(requestMessages)
    setDraft('')
    setPending(true)
    setError(null)

    try {
      const result = await onChat({
        ...(includeCurrentMessage && messageId !== undefined ? { messageId } : {}),
        messages: requestMessages
      })
      if (requestTokenRef.current !== requestToken) return
      setMessages((current) => [...current, result.message])
    } catch (chatError) {
      if (requestTokenRef.current !== requestToken) return
      setError(chatError instanceof Error ? chatError.message : t('ai.chat.error'))
    } finally {
      if (requestTokenRef.current === requestToken) setPending(false)
    }
  }

  function sendQuickPrompt(prompt: string): void {
    setAttachCurrentMessage(true)
    void sendMessage(prompt, true)
  }

  const hasCurrentMessage = messageId !== undefined
  const currentMessageSubject = messageSubject?.trim() || t('common.noSubject')
  const contextLabel = !hasCurrentMessage
    ? t('ai.chat.noContext')
    : attachCurrentMessage
      ? t('ai.chat.contextAttached', { subject: currentMessageSubject })
      : t('ai.chat.contextDetached')
  const serviceHost = getServiceHost(settings.baseUrl)

  function handleOpenChange(nextOpen: boolean): void {
    setOpen(nextOpen)
    if (!nextOpen) {
      window.setTimeout(() => launcherRef.current?.focus(), 0)
    }
  }

  function resetConversation(): void {
    requestTokenRef.current += 1
    setMessages([])
    setDraft('')
    setPending(false)
    setError(null)
    window.setTimeout(() => composerRef.current?.focus(), 0)
  }

  return (
    <>
      {!launcherHidden ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                ref={launcherRef}
                type="button"
                size="icon-lg"
                className="app-no-drag fixed right-5 bottom-10 z-30 size-11 rounded-full shadow-[0_12px_32px_rgb(0_0_0/0.24)]"
                aria-label={t('ai.launcher')}
                aria-expanded={open}
                onClick={() => handleOpenChange(true)}
              >
                <Sparkles className="size-5" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">{t('ai.launcher')}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : null}

      {open ? (
        <section
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          className="app-no-drag fixed inset-x-4 bottom-24 z-40 flex h-[min(600px,calc(100dvh-7rem))] flex-col overflow-hidden rounded-[14px] border border-border bg-background shadow-[0_24px_80px_rgb(0_0_0/0.28)] sm:right-5 sm:left-auto sm:w-[420px]"
        >
          <h2 id={titleId} className="sr-only">
            {t('ai.chat.title')}
          </h2>
          <p id={descriptionId} className="sr-only">
            {t('ai.chat.description', { model: settings.model, service: serviceHost })}
          </p>

          <div className="flex shrink-0 items-center justify-between border-b border-border p-1.5">
            <div className="flex min-w-0 items-center">
              <ContextTab
                active={!attachCurrentMessage}
                label={t('ai.chat.title')}
                onClick={() => setAttachCurrentMessage(false)}
              />
              <ContextTab
                active={attachCurrentMessage}
                label={t('ai.chat.attachCurrentMessage')}
                disabled={!hasCurrentMessage || pending}
                onClick={() => setAttachCurrentMessage(true)}
              />
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <HeaderAction
                label={t('ai.chat.reset')}
                disabled={messages.length === 0 && !draft && !error}
                onClick={resetConversation}
              >
                <RotateCcw aria-hidden="true" />
              </HeaderAction>
              <HeaderAction label={t('common.close')} onClick={() => handleOpenChange(false)}>
                <X aria-hidden="true" />
              </HeaderAction>
            </div>
          </div>

          {attachCurrentMessage && hasCurrentMessage ? (
            <div
              className="flex shrink-0 items-center gap-1.5 border-b border-border/70 bg-muted/25 px-3 py-1.5 text-[11px] text-muted-foreground"
              aria-live="polite"
              title={contextLabel}
            >
              <Mail className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{currentMessageSubject}</span>
            </div>
          ) : null}

          <div
            className="min-h-0 flex-1 overflow-y-auto px-3 pt-3 pb-1"
            role="log"
            aria-live="polite"
            aria-relevant="additions text"
          >
            {messages.length === 0 ? (
              <div className="flex min-h-full flex-col items-center justify-center gap-2 px-5 py-8 text-center">
                <div className="flex size-9 items-center justify-center rounded-[10px] bg-muted text-foreground">
                  <Sparkles className="size-4" aria-hidden="true" />
                </div>
                <div className="text-[13px] font-medium text-foreground">
                  {t('ai.chat.emptyTitle')}
                </div>
                <p className="max-w-xs text-[12px] leading-relaxed text-muted-foreground">
                  {attachCurrentMessage
                    ? t('ai.chat.emptyWithContext')
                    : t('ai.chat.emptyDescription')}
                </p>
                <div
                  className="mt-2 flex flex-wrap justify-center gap-1.5"
                  aria-label={t('ai.chat.quickActions')}
                >
                  <QuickPromptButton
                    label={t('ai.chat.quickSummary')}
                    disabled={!hasCurrentMessage || pending}
                    onClick={() => sendQuickPrompt(t('ai.chat.quickSummaryPrompt'))}
                  />
                  <QuickPromptButton
                    label={t('ai.chat.quickTasks')}
                    disabled={!hasCurrentMessage || pending}
                    onClick={() => sendQuickPrompt(t('ai.chat.quickTasksPrompt'))}
                  />
                  <QuickPromptButton
                    label={t('ai.chat.quickReply')}
                    disabled={!hasCurrentMessage || pending}
                    onClick={() => sendQuickPrompt(t('ai.chat.quickReplyPrompt'))}
                  />
                </div>
                <p className="mt-2 max-w-xs text-[10.5px] leading-relaxed text-muted-foreground/80">
                  {t('ai.chat.privacyNotice')}
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {messages.map((message, index) => (
                  <ChatMessage
                    key={`${message.role}-${index}`}
                    message={message}
                    model={settings.model}
                  />
                ))}
                {pending ? (
                  <div className="flex items-center gap-2 py-1 text-[12px] text-muted-foreground">
                    <Sparkles className="size-3.5" aria-hidden="true" />
                    <SweepShine>{t('ai.chat.thinking')}</SweepShine>
                  </div>
                ) : null}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          <form
            className="mt-auto shrink-0 p-1.5"
            onSubmit={(event) => {
              event.preventDefault()
              void sendMessage(draft)
            }}
          >
            {error ? (
              <div
                role="alert"
                className="mb-1.5 rounded-[8px] bg-destructive/10 px-2.5 py-2 text-[11px] leading-relaxed text-destructive"
              >
                {error}
              </div>
            ) : null}
            <div
              className="flex cursor-text flex-col gap-2 rounded-[12px] border border-border bg-muted/35 p-2.5 shadow-[0_1px_2px_rgb(0_0_0/0.04)] transition-[border-color,box-shadow] duration-150 focus-within:border-ring/50 focus-within:shadow-[0_1px_3px_rgb(0_0_0/0.06)]"
              onClick={() => composerRef.current?.focus()}
            >
              <textarea
                ref={composerRef}
                className="max-h-32 min-h-12 w-full resize-none bg-transparent text-[13px] leading-[1.45] text-foreground outline-none placeholder:text-muted-foreground"
                rows={2}
                value={draft}
                disabled={pending}
                placeholder={t('ai.chat.placeholder')}
                aria-label={t('ai.chat.placeholder')}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key !== 'Enter' ||
                    event.shiftKey ||
                    event.nativeEvent.isComposing
                  ) {
                    return
                  }
                  event.preventDefault()
                  event.currentTarget.form?.requestSubmit()
                }}
              />
              <div className="flex min-w-0 items-center justify-between gap-2">
                <span
                  className="min-w-0 truncate text-[10.5px] text-muted-foreground"
                  title={`${settings.model} · ${serviceHost}`}
                >
                  {settings.model}
                </span>
                <button
                  type="submit"
                  disabled={pending || !draft.trim()}
                  aria-label={t('ai.chat.send')}
                  className="flex size-7 shrink-0 items-center justify-center rounded-[8px] bg-foreground text-background transition-[background-color,color,transform] duration-150 enabled:active:scale-[0.96] disabled:bg-border disabled:text-muted-foreground"
                >
                  <Send className="size-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          </form>
        </section>
      ) : null}
    </>
  )
}

function ChatMessage({
  message,
  model
}: {
  message: AiChatMessage
  model: string
}): React.JSX.Element {
  const user = message.role === 'user'

  if (user) {
    return (
      <div className="flex justify-end pl-14">
        <div className="max-w-full rounded-xl bg-muted px-3 py-1.5 text-[13px] leading-[1.45] text-foreground">
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex w-full flex-col gap-1.5 py-1">
      <div className="flex items-center gap-1.5 text-[11px] leading-none text-muted-foreground">
        <Sparkles className="size-3.5" aria-hidden="true" />
        <span className="font-medium text-foreground">AI</span>
        <span className="truncate">{model}</span>
      </div>
      <div className="text-[13px] leading-relaxed text-foreground">
        <p className="whitespace-pre-wrap break-words">{message.content}</p>
      </div>
    </div>
  )
}

function ContextTab({
  active,
  label,
  disabled = false,
  onClick
}: {
  active: boolean
  label: string
  disabled?: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`max-w-44 truncate rounded-[6px] px-2 py-1 text-[12px] transition-[background-color,opacity] duration-100 ${
        active ? 'bg-muted text-foreground' : 'text-foreground opacity-50 hover:opacity-75'
      } disabled:pointer-events-none disabled:opacity-30`}
    >
      {label}
    </button>
  )
}

function HeaderAction({
  label,
  disabled = false,
  onClick,
  children
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-7 items-center justify-center rounded-[6px] text-muted-foreground transition-colors duration-100 hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30 [&_svg]:size-3.5"
    >
      {children}
    </button>
  )
}

function QuickPromptButton({
  label,
  disabled,
  onClick
}: {
  label: string
  disabled: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded-[7px] border border-border bg-background px-2 py-1 text-[11px] text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.03)] transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
    >
      {label}
    </button>
  )
}

function getServiceHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host
  } catch {
    return baseUrl
  }
}

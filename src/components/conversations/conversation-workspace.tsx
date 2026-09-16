import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'
import { formatAbsoluteTime, formatRelativeTime } from '@renderer/components/mail/date-format'
import { DefaultAvatar } from '@renderer/components/default-avatar'
import './conversation-workspace.css'
import { ArrowLeft, ArrowUp, Inbox, Loader2, MessageCircle, Plus, Search, SlidersHorizontal, Users } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Textarea } from '@renderer/components/ui/textarea'
import { ResponsiveDialog } from '@renderer/components/responsive-dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@renderer/components/ui/select'
import type { Account } from '@renderer/components/mail/types'
import type { ConversationMessage, ConversationSummary } from '@renderer/shared/conversations'
import { createComposeDraft, sendComposedMessage, type ComposeDraft } from '@renderer/lib/api'
import { useI18n } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import { useConversations } from './use-conversations'
import { ConversationMessageContent } from './conversation-message-content'
import type { AppSettings } from '@renderer/shared/types'

export type ConversationWorkspaceProps = {
  accounts: Account[]
  settings: AppSettings | null
  accountId?: number
  onCompose: () => void
  onOpenOutbox: () => void
  refreshKey?: number
}

export function ConversationWorkspace({ accounts, settings, accountId, onCompose, onOpenOutbox, refreshKey }: ConversationWorkspaceProps) {
  const { locale } = useI18n()
  const zh = locale === 'zh-CN'
  const text = (cn: string, en: string) => zh ? cn : en
  const state = useConversations(accountId, refreshKey)
  const selected = state.conversations.find((item) => item.conversationId === state.selectedId)
  const listRoot = useRef<HTMLDivElement>(null)
  const loadMoreTarget = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!state.hasMore || state.loading || state.error || !listRoot.current || !loadMoreTarget.current) return
    let triggered = false
    const observer = new IntersectionObserver((entries) => {
      if (triggered || !entries.some((entry) => entry.isIntersecting)) return
      triggered = true
      observer.disconnect()
      state.loadMore()
    }, { root: listRoot.current, rootMargin: '0px 0px 300px 0px' })
    observer.observe(loadMoreTarget.current)
    return () => { triggered = true; observer.disconnect() }
  }, [state.hasMore, state.loading, state.error, state.loadMore])

  return <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
    <section className={cn('conversation-list flex w-full shrink-0 flex-col border-r md:w-72 lg:w-80', selected && 'hidden md:flex')}>
      <div className="flex h-12 shrink-0 items-center justify-between px-3">
        <h2 className="font-semibold">{text('对话', 'Conversations')}</h2>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" onClick={onOpenOutbox} title={text('发件箱', 'Outbox')} aria-label={text('发件箱', 'Outbox')}><Inbox className="size-4" /></Button>
          <Button variant="ghost" size="icon" onClick={onCompose} title={text('新对话', 'New conversation')} aria-label={text('新对话', 'New conversation')}><Plus className="size-4" /></Button>
        </div>
      </div>
      <div className="conversation-search relative mx-3 mb-2"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input className="pl-9" value={state.keyword} onChange={(event) => state.setKeyword(event.target.value)} placeholder={text('搜索联系人或邮箱', 'Search people or email')} aria-label={text('搜索联系人或邮箱', 'Search people or email')} /></div>
      <div ref={listRoot} className="min-h-0 flex-1 overflow-y-auto pb-2">
        {state.error && <p role="alert" className="p-3 text-sm text-destructive">{state.error}<Button variant="ghost" size="sm" onClick={state.refresh}>{text('重试', 'Retry')}</Button></p>}
        {state.loading && state.conversations.length === 0 && <div role="status" className="flex items-center justify-center gap-2 py-3 text-xs text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden="true" />{text('加载中…', 'Loading…')}</div>}
        {!state.loading && !state.error && state.conversations.length === 0 && <p className="p-4 text-center text-sm text-muted-foreground">{text('暂无对话', 'No conversations yet')}</p>}
        {state.conversations.map((item) => <button key={item.conversationId} type="button" aria-current={selected?.conversationId === item.conversationId ? 'true' : undefined} onClick={() => state.setSelectedId(item.conversationId)} className={cn('conversation-row flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring', selected?.conversationId === item.conversationId && 'is-selected')}>
          <div className="relative shrink-0">
            <ConversationAvatar seed={item.participants[0]?.email || item.conversationId} group={item.isGroup} compact />
            {item.unreadCount > 0 && <span className="conversation-unread absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] tabular-nums" aria-label={text(`${item.unreadCount} 条未读`, `${item.unreadCount} unread messages`)}>{item.unreadCount > 99 ? '99+' : item.unreadCount}</span>}
          </div>
          <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="truncate text-sm font-medium">{item.displayName}</span><time dateTime={item.lastMessage.receivedAt} title={formatAbsoluteTime(item.lastMessage.receivedAt)} className="ml-auto shrink-0 text-[11px] text-muted-foreground">{formatRelativeTime(item.lastMessage.receivedAt, locale)}</time></div><p className="mt-0.5 truncate text-xs leading-4 text-muted-foreground">{item.lastMessage.snippet || item.lastMessage.subject || text('无主题', 'No subject')}</p></div>
        </button>)}
        <div ref={loadMoreTarget} className="min-h-px">
          {state.loading && state.conversations.length > 0 && <div role="status" className="flex items-center justify-center gap-2 py-3 text-xs text-muted-foreground"><Loader2 className="size-4 animate-spin" />{text('加载中…', 'Loading…')}</div>}
        </div>
      </div>
    </section>
    {selected ? <ConversationPane key={`${accountId ?? 'all'}:${selected.conversationId}`} conversation={selected} settings={settings} messages={state.messages} accounts={accounts} loading={state.loadingMessages} error={state.messageError} hasOlder={state.hasOlder} loadOlder={state.loadOlder} onBack={() => state.setSelectedId(null)} onOpenOutbox={onOpenOutbox} refresh={state.refresh} /> : <div className="conversation-empty hidden flex-1 flex-col items-center justify-center gap-4 text-muted-foreground md:flex"><MessageCircle className="size-16 stroke-1 opacity-25" /><p className="text-sm">{text('选择一个人，继续交流', 'Choose a person to continue the conversation')}</p><Button variant="outline" onClick={onCompose}>{text('发起对话', 'Start a conversation')}</Button></div>}
  </div>
}

function ConversationPane({ conversation, settings, messages, accounts, loading, error, hasOlder, loadOlder, onBack, onOpenOutbox, refresh }: {
  settings: AppSettings | null; conversation: ConversationSummary; messages: ConversationMessage[]; accounts: Account[]; loading: boolean; error: string; hasOlder: boolean; loadOlder: () => void; onBack: () => void; onOpenOutbox: () => void; refresh: () => void
}) {
  const { locale } = useI18n()
  const text = (cn: string, en: string) => locale === 'zh-CN' ? cn : en
  const [newTopic, setNewTopic] = useState(false)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [replyAll, setReplyAll] = useState(conversation.isGroup)
  const [draft, setDraft] = useState<ComposeDraft | null>(null)
  const [body, setBody] = useState('')
  const [subject, setSubject] = useState('')
  const [sending, setSending] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [sendError, setSendError] = useState('')
  const [notice, setNotice] = useState('')
  const latest = messages[0]
  const [newAccountId, setNewAccountId] = useState<number | undefined>(conversation.lastMessage.accountId)
  const bottom = useRef<HTMLDivElement>(null)
  const paneRef = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    if (!paneRef.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const context = gsap.context(() => {
      gsap.fromTo(paneRef.current, { opacity: 0, x: 12 }, {
        opacity: 1, x: 0, duration: 0.24, ease: 'power3.out', clearProps: 'opacity,transform'
      })
    }, paneRef)
    return () => context.revert()
  }, [])
  const latestId = messages[0]?.id
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }) }, [latestId])
  useEffect(() => {
    let cancelled = false
    setDraft(null)
    setSendError('')
    setPreparing(true)
    async function prepare() {
      const chosenAccount = newTopic ? newAccountId : latest?.accountId
      if (!chosenAccount || (!newTopic && !latest)) return
      let next: ComposeDraft
      if (!newTopic && latest?.source === 'message' && latest.messageId && latest.direction === 'incoming') {
        next = await createComposeDraft({ kind: replyAll ? 'reply_all' : 'reply', accountId: chosenAccount, relatedMessageId: latest.messageId })
      } else {
        next = await createComposeDraft({ kind: 'new', accountId: chosenAccount })
        next.to = newTopic ? conversation.participants.map((person) => person.email) : latest!.to.map((person) => person.email)
        next.cc = !newTopic && replyAll ? latest!.cc.map((person) => person.email) : []
        if (!newTopic) {
          next.subject = latest!.subject ?? ''
          next.inReplyTo = latest!.messageRfc822Id ?? undefined
          next.references = [latest!.references, latest!.messageRfc822Id].filter(Boolean).join(' ') || undefined
        }
      }
      const ownAddress = accounts.find((account) => account.accountId === chosenAccount)?.address.toLowerCase()
      next.to = next.to.filter((email) => email.toLowerCase() !== ownAddress)
      next.cc = next.cc.filter((email) => email.toLowerCase() !== ownAddress && !next.to.some((to) => to.toLowerCase() === email.toLowerCase()))
      if (!cancelled) setDraft(next)
    }
    void prepare().catch((reason: unknown) => { if (!cancelled) setSendError(String(reason)) }).finally(() => { if (!cancelled) setPreparing(false) })
    return () => { cancelled = true }
  }, [latest?.id, newTopic, newAccountId, replyAll, conversation.conversationId])

  async function send() {
    if (!draft || !body.trim() || (newTopic && !subject.trim())) return
    setSending(true); setSendError(''); setNotice('')
    try {
      const result = await sendComposedMessage({ ...draft, bodyText: body, bodyHtml: undefined, attachments: [], subject: newTopic ? subject.trim() : draft.subject })
      if (!result.sent) { setSendError(result.warning || text('发送失败，请到发件箱查看', 'Sending failed. Check the outbox.')); return }
      setBody(''); setSubject(''); setNewTopic(false)
      setNotice(result.warning || text('已发送', 'Sent')); refresh()
    } catch (reason) { setSendError(String(reason)) } finally { setSending(false) }
  }

  const chronological = [...messages].reverse()
  return <section ref={paneRef} className="conversation-pane flex min-h-0 min-w-0 flex-1 flex-col">
    <header className="flex min-h-14 shrink-0 items-center gap-2 border-b px-5 py-2"><Button variant="ghost" size="icon" className="md:hidden" onClick={onBack} aria-label={text('返回', 'Back')}><ArrowLeft className="size-4" /></Button><div className="min-w-0"><h2 className="truncate text-sm font-semibold">{conversation.displayName}</h2><p className="truncate text-xs text-muted-foreground" title={conversation.participants.map((p) => p.email).join(', ')}>{conversation.participants.map((p) => p.email).join(', ')}</p></div></header>
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
      {hasOlder && <div className="text-center"><Button variant="ghost" size="sm" disabled={loading} onClick={loadOlder}>{text('加载更早的消息', 'Load older messages')}</Button></div>}
      {loading && <div role="status" className="flex items-center justify-center gap-2 py-3 text-xs text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden="true" />{text('加载中…', 'Loading…')}</div>}
      {error && <p role="alert" className="text-sm text-destructive">{error}<Button variant="ghost" onClick={refresh}>{text('重试', 'Retry')}</Button></p>}
      {chronological.map((message, index) => <div key={message.id}>
        {(index === 0 || chronological[index - 1].subject !== message.subject) && <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground"><div className="h-px flex-1 bg-border" /><span className="max-w-[75%] truncate">{message.subject || text('无主题', 'No subject')}</span><div className="h-px flex-1 bg-border" /></div>}
        <article className={cn('mb-5 flex items-start gap-3', message.direction === 'outgoing' && 'flex-row-reverse')}>
          <ConversationAvatar seed={message.fromEmail || (message.direction === 'outgoing' ? accounts.find((account) => account.accountId === message.accountId)?.address || `account:${message.accountId}` : message.fromName || conversation.conversationId)} outgoing={message.direction === 'outgoing'} />
          <div className={cn('flex min-w-0 max-w-[calc(100%-3.25rem)] flex-col items-start md:max-w-[80%]', message.direction === 'outgoing' && 'items-end')}>
          <p className="mb-1 max-w-full break-all text-[11px] text-muted-foreground">{message.fromName || message.fromEmail}</p>
          <div className={cn('conversation-bubble relative min-w-0 max-w-full rounded px-3 py-2.5', message.direction === 'outgoing' && 'is-outgoing')}>
            <ConversationMessageContent key={message.id} message={message} refresh={refresh} bodyDisplayMode={settings?.bodyDisplayMode ?? 'text'} externalImagesBlocked={settings?.externalImagesBlocked ?? true}>
              <time dateTime={message.receivedAt} title={formatAbsoluteTime(message.receivedAt)} className="ml-auto shrink-0 whitespace-nowrap pl-2 text-[11px] leading-6 text-muted-foreground">{formatRelativeTime(message.receivedAt, locale)}</time>
            </ConversationMessageContent>
          </div>
          </div>
        </article>
      </div>)}
      <div ref={bottom} />
    </div>
    <div className="conversation-composer mx-3 mb-3 shrink-0 rounded-2xl border px-3 py-2 md:mx-4">
      <Textarea value={body} disabled={sending} onChange={(event) => setBody(event.target.value)} rows={2} className="min-h-14 max-h-40 resize-none rounded-none border-0 bg-transparent px-0 py-2 shadow-none focus-visible:ring-0 dark:bg-transparent" placeholder={text('写下你的回复…', 'Write your reply…')} aria-label={text('回复内容', 'Reply text')} />
      <div className="mt-1 flex min-h-8 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1 text-xs">
          <Button className="h-7 px-1.5 text-xs text-muted-foreground" size="sm" variant="ghost" disabled={sending} onClick={() => setOptionsOpen(true)} aria-haspopup="dialog" aria-busy={preparing}>{preparing ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <SlidersHorizontal className="size-3.5" />}{preparing ? text('加载中…', 'Loading…') : text(newTopic ? '新话题选项' : '发送选项', newTopic ? 'Topic options' : 'Send options')}</Button>
          {!newTopic && <Button className="h-7 px-1.5 text-xs text-muted-foreground" size="sm" variant="ghost" disabled={sending} onClick={() => { setNewTopic(true); setOptionsOpen(true) }} aria-haspopup="dialog"><Plus className="size-3.5" />{text('新话题', 'New topic')}</Button>}
        </div>
        {body.trim() && <Button className="conversation-send size-8 shrink-0 rounded-full" size="icon" disabled={sending || preparing || !draft?.to.length || (newTopic && !subject.trim())} onClick={() => void send()} title={text('发送', 'Send')} aria-label={sending ? text('发送中', 'Sending') : text('发送', 'Send')}>{sending || preparing ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}</Button>}
      </div>
      {(sendError || notice) && <div className="mt-2 break-words text-xs">{sendError && <p role="alert" className="text-destructive">{sendError}<button className="ml-2 underline" onClick={onOpenOutbox}>{text('查看发件箱', 'View outbox')}</button></p>}{notice && <p role="status" className="text-muted-foreground">{notice}</p>}</div>}
    </div>
    <ResponsiveDialog
      open={optionsOpen}
      onOpenChange={setOptionsOpen}
      title={text('发送选项', 'Send options')}
      description={text('查看收发件信息，设置本次回复或新话题。', 'Review recipients and configure this reply or a new topic.')}
      contentClassName="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 md:max-w-md"
      headerClassName="shrink-0 bg-muted/50 px-4 py-3 pr-12 text-left"
      bodyClassName="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3"
      footerClassName="shrink-0 bg-muted/50 px-4 py-2"
      footer={<Button size="sm" disabled={preparing || (newTopic && !subject.trim())} aria-busy={preparing} onClick={() => setOptionsOpen(false)}>{preparing && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}{preparing ? text('加载中…', 'Loading…') : text('完成', 'Done')}</Button>}
    >
      <div className="space-y-1.5">
        <p className="text-xs font-medium">{text('发送方式', 'Message type')}</p>
        <Select value={newTopic ? 'new' : 'reply'} onValueChange={(value) => setNewTopic(value === 'new')} disabled={sending}>
          <SelectTrigger className="w-full" aria-label={text('发送方式', 'Message type')}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="reply">{text('回复当前话题', 'Reply to current topic')}</SelectItem>
            <SelectItem value="new">{text('新话题', 'New topic')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <p className="text-xs font-medium">{text('主题', 'Subject')}</p>
        {newTopic ? <Input value={subject} disabled={sending} onChange={(event) => setSubject(event.target.value)} placeholder={text('填写新话题主题', 'Enter a subject')} aria-label={text('主题', 'Subject')} required /> : <p className="break-words text-sm text-muted-foreground">{draft?.subject || latest?.subject || text('无主题', 'No subject')}</p>}
      </div>
      <div className="space-y-1.5">
        <p className="text-xs font-medium">{text('发件账号', 'Sending account')}</p>
        {newTopic ? <Select value={newAccountId === undefined ? '' : String(newAccountId)} onValueChange={(value) => setNewAccountId(Number(value))} disabled={sending}>
          <SelectTrigger className="w-full" aria-label={text('发件账号', 'Sending account')}><SelectValue /></SelectTrigger>
          <SelectContent>{accounts.filter((account) => account.accountId).map((account) => <SelectItem key={account.id} value={String(account.accountId)}>{account.address}</SelectItem>)}</SelectContent>
        </Select> : <p className="break-all text-sm text-muted-foreground">{accounts.find((account) => account.accountId === draft?.accountId)?.address || '—'}</p>}
      </div>
      {!newTopic && conversation.isGroup && latest?.direction === 'incoming' && <div className="space-y-1.5">
        <p className="text-xs font-medium">{text('回复范围', 'Reply scope')}</p>
        <Select value={replyAll ? 'all' : 'sender'} onValueChange={(value) => setReplyAll(value === 'all')} disabled={sending}>
          <SelectTrigger className="w-full" aria-label={text('回复范围', 'Reply scope')}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{text('回复所有人', 'Reply all')}</SelectItem>
            <SelectItem value="sender">{text('仅回复发件人', 'Reply sender')}</SelectItem>
          </SelectContent>
        </Select>
      </div>}
      <dl className="space-y-3 text-xs">
        <div><dt className="mb-1 font-medium">{text('收件人', 'To')}</dt><dd className="break-all text-sm text-muted-foreground">{preparing ? text('正在准备…', 'Preparing…') : draft?.to.join(', ') || '—'}</dd></div>
        {Boolean(draft?.cc.length) && <div><dt className="mb-1 font-medium">{text('抄送', 'Cc')}</dt><dd className="break-all text-sm text-muted-foreground">{draft!.cc.join(', ')}</dd></div>}
      </dl>
      {sendError && <p role="alert" className="text-xs text-destructive">{sendError}</p>}
    </ResponsiveDialog>
  </section>
}

function ConversationAvatar({ seed, group = false, outgoing = false, compact = false }: { seed: string; group?: boolean; outgoing?: boolean; compact?: boolean }) {
  return <div aria-hidden="true" className={cn('conversation-avatar flex shrink-0 items-center justify-center rounded text-base font-medium', compact ? 'size-9' : 'size-10', outgoing && 'is-outgoing')}>
    {group ? <Users className="size-5" /> : <DefaultAvatar seed={seed} className="size-full rounded" />}
  </div>
}

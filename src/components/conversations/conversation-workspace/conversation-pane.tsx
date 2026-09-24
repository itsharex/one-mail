import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { formatAbsoluteTime, formatRelativeTime } from "@renderer/components/mail/date-format";
import { ArrowLeft, ChevronDown, CircleAlert, Copy, Reply, Users } from "lucide-react";
import { Button } from "@renderer/components/ui/button";
import { copyTextToClipboard } from "@renderer/components/ui/copy-button";
import { Skeleton } from "@renderer/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@renderer/components/ui/tooltip";
import { CopyableText } from "@renderer/components/ui/copyable-text";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@renderer/components/ui/context-menu";
import { Account } from "@renderer/components/mail/types";
import { ConversationMessage, ConversationSummary } from "@renderer/shared/conversations";
import { createComposeDraft, sendComposedMessage, type ComposeDraft } from "@renderer/lib/api";
import { useI18n } from "@renderer/lib/i18n";
import { startWindowDrag } from "@renderer/lib/window-drag";
import { cn } from "@renderer/lib/utils";
import { ConversationMessageContent } from "../conversation-message-content";
import { AppSettings } from "@renderer/shared/types";
import { ConversationAvatar } from './conversation-avatar';
import { ConversationDialogs } from './conversation-dialogs';
import { ConversationComposer } from './conversation-composer';
import { ConversationAiMenu, ConversationAiResult, type ConversationAiSelection } from './conversation-ai-actions';
import type { AiChatInput, AiChatResult, AiSettings } from '@renderer/shared/types';

export function ConversationPane({
  conversation,
  settings,
  messages,
  focusedMessageId,
  focusToken,
  accounts,
  loading,
  loadingOlder,
  error,
  hasOlder,
  loadOlder,
  onBack,
  onOpenOutbox,
  onOpenOriginal,
  refresh,
  aiSettings,
  onAiChat,
}: {
  settings: AppSettings | null;
  conversation: ConversationSummary;
  messages: ConversationMessage[];
  focusedMessageId: string | null;
  focusToken: number;
  accounts: Account[];
  loading: boolean;
  loadingOlder: boolean;
  error: string;
  hasOlder: boolean;
  loadOlder: () => void;
  onBack: () => void;
  onOpenOutbox: () => void;
  onOpenOriginal: (message: ConversationMessage) => void;
  refresh: () => void;
  aiSettings?: AiSettings;
  onAiChat?: (input: AiChatInput) => Promise<AiChatResult>;
}) {
  const { locale, t } = useI18n();
  const text = (cn: string, en: string) => (locale === "zh-CN" ? cn : en);
  const [replyTarget, setReplyTarget] = useState<ConversationMessage | null>(
    null,
  );
  const [newTopic, setNewTopic] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [participantsOpen, setParticipantsOpen] = useState(false);
  const [replyAll, setReplyAll] = useState(conversation.isGroup);
  const [draft, setDraft] = useState<ComposeDraft | null>(null);
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("");
  const [sending, setSending] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [sendError, setSendError] = useState("");
  const [notice, setNotice] = useState("");
  const [aiInsight, setAiInsight] = useState<ConversationAiSelection | null>(null);
  const replyMessage = replyTarget ?? messages[0];
  const replyInput = useRef<HTMLTextAreaElement>(null);
  const focusReplyInput = useRef(false);
  const [newAccountId, setNewAccountId] = useState<number | undefined>(
    conversation.lastMessage.accountId,
  );
  const scrollArea = useRef<HTMLDivElement>(null);
  const scrollContent = useRef<HTMLDivElement>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const updateScrollToBottom = () => {
    const area = scrollArea.current;
    if (area) setShowScrollToBottom(area.scrollHeight - area.scrollTop - area.clientHeight > 2);
  };
  useEffect(() => {
    const area = scrollArea.current;
    const content = scrollContent.current;
    if (!area || !content) return;
    const observer = new ResizeObserver(updateScrollToBottom);
    observer.observe(area);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);
  const latestId = messages[0]?.id;
  const focusedMessageLoaded = messages.some((message) => message.id === focusedMessageId);
  useLayoutEffect(() => {
    const area = scrollArea.current;
    if (area && latestId && !focusedMessageId) area.scrollTop = area.scrollHeight;
  }, [latestId, focusedMessageId]);
  useLayoutEffect(() => {
    const area = scrollArea.current;
    if (!area || !focusedMessageId || !focusedMessageLoaded) return;
    const target = Array.from(area.querySelectorAll<HTMLElement>('[data-message-id]'))
      .find((element) => element.dataset.messageId === focusedMessageId);
    if (!target) return;
    const areaRect = area.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    area.scrollTop += targetRect.top - areaRect.top - (areaRect.height - targetRect.height) / 2;
    target.classList.remove('conversation-focus-flash');
    void target.offsetWidth;
    target.classList.add('conversation-focus-flash');
  }, [focusedMessageId, focusedMessageLoaded, focusToken]);
  useEffect(() => {
    let cancelled = false;
    setDraft(null);
    setSendError("");
    setPreparing(true);
    async function prepare() {
      const chosenAccount = newTopic ? newAccountId : replyMessage?.accountId;
      if (!chosenAccount || (!newTopic && !replyMessage)) return;
      let next: ComposeDraft;
      if (
        !newTopic &&
        replyMessage?.source === "message" &&
        replyMessage.messageId &&
        replyMessage.direction === "incoming"
      ) {
        next = await createComposeDraft({
          kind: replyAll ? "reply_all" : "reply",
          accountId: chosenAccount,
          relatedMessageId: replyMessage.messageId,
        });
      } else {
        next = await createComposeDraft({
          kind: "new",
          accountId: chosenAccount,
        });
        next.to = newTopic
          ? conversation.participants.map((person) => person.email)
          : replyMessage!.to.map((person) => person.email);
        next.cc =
          !newTopic && replyAll
            ? replyMessage!.cc.map((person) => person.email)
            : [];
        if (!newTopic) {
          next.subject = replyMessage!.subject ?? "";
          next.inReplyTo = replyMessage!.messageRfc822Id ?? undefined;
          next.references =
            [replyMessage!.references, replyMessage!.messageRfc822Id]
              .filter(Boolean)
              .join(" ") || undefined;
        }
      }
      const ownAddress = accounts
        .find((account) => account.accountId === chosenAccount)
        ?.address.toLowerCase();
      next.to = next.to.filter((email) => email.toLowerCase() !== ownAddress);
      next.cc = next.cc.filter(
        (email) =>
          email.toLowerCase() !== ownAddress &&
          !next.to.some((to) => to.toLowerCase() === email.toLowerCase()),
      );
      if (!cancelled) setDraft(next);
    }
    void prepare()
      .catch((reason: unknown) => {
        if (!cancelled) setSendError(String(reason));
      })
      .finally(() => {
        if (!cancelled) setPreparing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    replyMessage?.id,
    newTopic,
    newAccountId,
    replyAll,
    conversation.conversationId,
  ]);

  async function send() {
    if (
      sending ||
      preparing ||
      !draft ||
      !body.trim() ||
      (newTopic && !subject.trim())
    )
      return;
    setSending(true);
    setSendError("");
    setNotice("");
    try {
      const result = await sendComposedMessage({
        ...draft,
        bodyText: body,
        bodyHtml: undefined,
        attachments: [],
        subject: newTopic ? subject.trim() : draft.subject,
      });
      if (!result.sent) {
        setSendError(
          result.warning ||
            text(
              "发送失败，请到发件箱查看",
              "Sending failed. Check the outbox.",
            ),
        );
        return;
      }
      setBody("");
      setSubject("");
      setNewTopic(false);
      setReplyTarget(null);
      setNotice(result.warning || text("已发送", "Sent"));
      refresh();
    } catch (reason) {
      setSendError(String(reason));
    } finally {
      setSending(false);
    }
  }

  const chronological = [...messages].reverse();
  const participantEmails = conversation.participants.map((person) => person.email).join(', ');
  const senderAccountId = newTopic ? newAccountId : replyMessage?.accountId ?? conversation.lastMessage.accountId;
  const senderEmail = accounts.find((account) => account.accountId === senderAccountId)?.address;
  return (
    <section
      className="conversation-pane flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <header
        className="app-drag-region flex min-h-12 shrink-0 items-center gap-2 border-b px-5 py-2"
        onMouseDown={startWindowDrag}
      >
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          onClick={onBack}
          aria-label={text("返回", "Back")}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <CopyableText value={participantEmails} className="min-w-0 flex-1 text-sm font-semibold leading-5" />
        <Button
          variant="ghost"
          size="icon-sm"
          className="app-no-drag shrink-0"
          onClick={() => setParticipantsOpen(true)}
          aria-label={text("查看参与者", "View participants")}
          title={text("查看参与者", "View participants")}
        >
          <Users className="size-4" aria-hidden="true" />
        </Button>
      </header>
      <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={scrollArea} onScroll={updateScrollToBottom} className="min-h-0 flex-1 overflow-y-auto px-5 py-4 [scrollbar-gutter:stable]">
        <div ref={scrollContent}>
        {hasOlder && (
          <div className="text-center">
            <Button
              variant="ghost"
              size="sm"
              disabled={loadingOlder}
              onClick={loadOlder}
            >
              {text("加载更早的消息", "Load older messages")}
            </Button>
          </div>
        )}
        {loading && messages.length === 0 && <div role="status" aria-label={text("加载邮件中", "Loading messages")} className="space-y-6 pt-5">
          {[false, true, false].map((outgoing, index) => <div key={index} className={cn("flex items-start gap-3", outgoing && "flex-row-reverse")}>
            <Skeleton className="size-9 shrink-0 rounded-full" />
            <div className="w-3/5 space-y-2">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-28 w-full rounded-lg" />
            </div>
          </div>)}
        </div>}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
            <Button variant="ghost" onClick={refresh}>
              {text("重试", "Retry")}
            </Button>
          </p>
        )}
        {chronological.map((message, index) => (
          <div key={message.id}>
            {(index === 0 ||
              chronological[index - 1].subject !== message.subject) && (
              <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
                <div className="h-px flex-1 bg-border" />
                <span className="max-w-[75%] break-words text-center">
                  {message.subject || text("无主题", "No subject")}
                </span>
                <div className="h-px flex-1 bg-border" />
              </div>
            )}
            <article
              data-message-id={message.id}
              className={cn(
                "conversation-message mb-5 flex items-start gap-3",
                message.direction === "outgoing" && "flex-row-reverse",
                focusedMessageId === message.id && "rounded-lg bg-primary/5 ring-1 ring-primary/25",
              )}
            >
              <ConversationAvatar
                seed={
                  message.fromEmail ||
                  (message.direction === "outgoing"
                    ? accounts.find(
                        (account) => account.accountId === message.accountId,
                      )?.address || `account:${message.accountId}`
                    : conversation.participants[0]?.email || conversation.conversationId)
                }
                outgoing={message.direction === "outgoing"}
              />
              <div
                className={cn(
                  "flex min-w-0 max-w-[calc(100%-3.25rem)] flex-col items-start md:max-w-[min(80%,48rem)]",
                  message.direction === "outgoing" && "items-end",
                )}
              >
                <p className="mb-1 max-w-full break-all text-[11px] text-muted-foreground">
                  {message.fromName || message.fromEmail}
                </p>
                <ContextMenu>
                  <ContextMenuTrigger asChild className="select-text">
                    <div
                      tabIndex={0}
                      aria-label={
                        text("邮件：", "Message: ") +
                        (message.subject ||
                          message.fromName ||
                          message.fromEmail ||
                          "")
                      }
                      className="min-w-0 max-w-full"
                    >
                      <ConversationMessageContent
                        key={message.id}
                        message={message}
                        refresh={refresh}
                        bodyDisplayMode={settings?.bodyDisplayMode ?? "text"}
                      >
                        {(copyBody) => <>
                          <Tooltip>
                            <TooltipTrigger asChild><Button type="button" variant="outline" size="icon-sm" disabled={sending} aria-label={text("回复", "Reply")} onClick={() => {
                              setReplyTarget(message);
                              setNewTopic(false);
                              setNotice("");
                              replyInput.current?.focus();
                            }}><Reply className="size-4" aria-hidden="true" /></Button></TooltipTrigger>
                            <TooltipContent side="bottom">{text("回复", "Reply")}</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild><Button type="button" variant="outline" size="icon-sm" disabled={!copyBody} aria-label={text("复制邮件内容", "Copy message content")} onClick={() => { if (copyBody) void copyTextToClipboard(copyBody, t) }}><Copy className="size-4" aria-hidden="true" /></Button></TooltipTrigger>
                            <TooltipContent side="bottom">{text("复制邮件内容", "Copy message content")}</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild><Button type="button" variant="outline" size="icon-sm" aria-label={text("显示原文", "Show original")} onClick={() => onOpenOriginal(message)}><CircleAlert className="size-4" aria-hidden="true" /></Button></TooltipTrigger>
                            <TooltipContent side="bottom">{text("显示原文", "Show original")}</TooltipContent>
                          </Tooltip>
                          {aiSettings && onAiChat && message.messageId && <ConversationAiMenu onSelect={(kind) => setAiInsight((current) => ({ messageId: message.messageId!, kind, token: (current?.token ?? 0) + 1 }))} />}
                          <time
                            dateTime={message.receivedAt}
                            title={formatAbsoluteTime(message.receivedAt)}
                            className="ml-auto shrink-0 whitespace-nowrap pl-2 text-[11px] leading-6 text-muted-foreground"
                          >
                            {formatRelativeTime(message.receivedAt, locale)}
                          </time>
                        </>}
                      </ConversationMessageContent>
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent
                    onCloseAutoFocus={(event) => {
                      if (!focusReplyInput.current) return;
                      event.preventDefault();
                      focusReplyInput.current = false;
                      replyInput.current?.focus();
                    }}
                  >
                    <ContextMenuItem
                      disabled={sending}
                      onSelect={() => {
                        setReplyTarget(message);
                        setNewTopic(false);
                        setNotice("");
                        focusReplyInput.current = true;
                      }}
                    >
                      <Reply className="size-4" />
                      {text("引用回复", "Quote reply")}
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              </div>
            </article>
            <ConversationAiResult selection={aiInsight} message={message} settings={aiSettings} onChat={onAiChat} onOpenOriginal={() => onOpenOriginal(message)} onClose={() => setAiInsight(null)} />
          </div>
        ))}
        </div>
      </div>
      {showScrollToBottom && <Button
        type="button"
        variant="outline"
        size="icon"
        className="absolute bottom-4 right-8 z-10 rounded-full bg-background shadow-md"
        aria-label={text("滚动到底部", "Scroll to bottom")}
        title={text("滚动到底部", "Scroll to bottom")}
        onClick={() => {
          const area = scrollArea.current;
          if (area) area.scrollTop = area.scrollHeight;
          setShowScrollToBottom(false);
        }}
      ><ChevronDown className="size-4" aria-hidden="true" /></Button>}
      </div>
      <ConversationComposer
        replyInput={replyInput}
        body={body}
        setBody={setBody}
        sending={sending}
        text={text}
        replyTarget={replyTarget}
        newTopic={newTopic}
        setReplyTarget={setReplyTarget}
        setOptionsOpen={setOptionsOpen}
        preparing={preparing}
        setNewTopic={setNewTopic}
        draft={draft}
        senderEmail={senderEmail}
        subject={subject}
        send={send}
        sendError={sendError}
        notice={notice}
        onOpenOutbox={onOpenOutbox}
        aiSettings={aiSettings}
        onAiChat={onAiChat}
        sourceMessage={replyMessage}
      />
      <ConversationDialogs
        participantsOpen={participantsOpen}
        setParticipantsOpen={setParticipantsOpen}
        optionsOpen={optionsOpen}
        setOptionsOpen={setOptionsOpen}
        conversation={conversation}
        text={text}
        preparing={preparing}
        newTopic={newTopic}
        setNewTopic={setNewTopic}
        subject={subject}
        setSubject={setSubject}
        replyTarget={replyTarget}
        setReplyTarget={setReplyTarget}
        sending={sending}
        draft={draft}
        replyMessage={replyMessage}
        accounts={accounts}
        newAccountId={newAccountId}
        setNewAccountId={setNewAccountId}
        replyAll={replyAll}
        setReplyAll={setReplyAll}
        sendError={sendError}
      />
    </section>
  );
}

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { formatAbsoluteTime, formatRelativeTime } from "@renderer/components/mail/date-format";
import { ArrowLeft, Loader2, Reply } from "lucide-react";
import { Button } from "@renderer/components/ui/button";
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

export function ConversationPane({
  conversation,
  settings,
  messages,
  focusedMessageId,
  accounts,
  loading,
  error,
  hasOlder,
  loadOlder,
  onBack,
  onOpenOutbox,
  refresh,
}: {
  settings: AppSettings | null;
  conversation: ConversationSummary;
  messages: ConversationMessage[];
  focusedMessageId: number | null;
  accounts: Account[];
  loading: boolean;
  error: string;
  hasOlder: boolean;
  loadOlder: () => void;
  onBack: () => void;
  onOpenOutbox: () => void;
  refresh: () => void;
}) {
  const { locale } = useI18n();
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
  const replyMessage = replyTarget ?? messages[0];
  const replyInput = useRef<HTMLTextAreaElement>(null);
  const focusReplyInput = useRef(false);
  const [newAccountId, setNewAccountId] = useState<number | undefined>(
    conversation.lastMessage.accountId,
  );
  const bottom = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (
      !paneRef.current ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const context = gsap.context(() => {
      gsap.fromTo(
        paneRef.current,
        { opacity: 0, x: 12 },
        {
          opacity: 1,
          x: 0,
          duration: 0.24,
          ease: "power3.out",
          clearProps: "opacity,transform",
        },
      );
    }, paneRef);
    return () => context.revert();
  }, []);
  const latestId = messages[0]?.id;
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [latestId]);
  useEffect(() => {
    if (!focusedMessageId) return;
    paneRef.current
      ?.querySelector(`[data-message-id="${focusedMessageId}"]`)
      ?.scrollIntoView({ block: "center" });
  }, [focusedMessageId, messages]);
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
  return (
    <section
      ref={paneRef}
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
        <button
          type="button"
          className="app-no-drag line-clamp-2 min-w-0 flex-1 break-words text-left text-sm font-semibold leading-5 outline-none hover:text-primary focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
          title={conversation.displayName}
          aria-label={text("查看参与者", "View participants")}
          onClick={() => setParticipantsOpen(true)}
        >
          {conversation.displayName}
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {hasOlder && (
          <div className="text-center">
            <Button
              variant="ghost"
              size="sm"
              disabled={loading}
              onClick={loadOlder}
            >
              {text("加载更早的消息", "Load older messages")}
            </Button>
          </div>
        )}
        {loading && (
          <div
            role="status"
            className="flex items-center justify-center gap-2 py-3 text-xs text-muted-foreground"
          >
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            {text("加载中…", "Loading…")}
          </div>
        )}
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
              data-message-id={message.messageId ?? undefined}
              className={cn(
                "mb-5 flex items-start gap-3",
                message.direction === "outgoing" && "flex-row-reverse",
                focusedMessageId === message.messageId && "rounded-lg bg-primary/5 ring-1 ring-primary/25",
              )}
            >
              <ConversationAvatar
                seed={
                  message.fromEmail ||
                  (message.direction === "outgoing"
                    ? accounts.find(
                        (account) => account.accountId === message.accountId,
                      )?.address || `account:${message.accountId}`
                    : message.fromName || conversation.conversationId)
                }
                outgoing={message.direction === "outgoing"}
              />
              <div
                className={cn(
                  "flex min-w-0 max-w-[calc(100%-3.25rem)] flex-col items-start md:max-w-[80%]",
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
                      className={cn(
                        "conversation-bubble relative min-w-0 max-w-full rounded px-3 py-2.5",
                        message.direction === "outgoing" && "is-outgoing",
                      )}
                    >
                      <ConversationMessageContent
                        key={message.id}
                        message={message}
                        refresh={refresh}
                        bodyDisplayMode={settings?.bodyDisplayMode ?? "text"}
                        externalImagesBlocked={
                          settings?.externalImagesBlocked ?? true
                        }
                      >
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 px-1 text-xs"
                          disabled={sending}
                          onClick={() => {
                            setReplyTarget(message);
                            setNewTopic(false);
                            setNotice("");
                            replyInput.current?.focus();
                          }}
                        >
                          <Reply className="size-3" />
                          {text("回复", "Reply")}
                        </Button>
                        <time
                          dateTime={message.receivedAt}
                          title={formatAbsoluteTime(message.receivedAt)}
                          className="ml-auto shrink-0 whitespace-nowrap pl-2 text-[11px] leading-6 text-muted-foreground"
                        >
                          {formatRelativeTime(message.receivedAt, locale)}
                        </time>
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
          </div>
        ))}
        <div ref={bottom} />
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
        subject={subject}
        send={send}
        sendError={sendError}
        notice={notice}
        onOpenOutbox={onOpenOutbox}
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

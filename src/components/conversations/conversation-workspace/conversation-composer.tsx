import * as React from 'react';
import { ArrowUp, Loader2, Mail, Plus, SlidersHorizontal, Sparkle, X } from 'lucide-react';
import { Badge } from '@renderer/components/ui/badge';
import { Button } from '@renderer/components/ui/button';
import { Textarea } from '@renderer/components/ui/textarea';
import { AiWritingCard } from '@renderer/components/ai/ai-writing-card';
import type { ConversationMessage } from '@renderer/shared/conversations';
import type { ComposeDraft } from '@renderer/lib/api';
import type { AiChatInput, AiChatResult, AiSettings } from '@renderer/shared/types';

type ConversationComposerProps = {
  replyInput: React.RefObject<HTMLTextAreaElement | null>;
  body: string;
  setBody: (value: string) => void;
  sending: boolean;
  text: (cn: string, en: string) => string;
  replyTarget: ConversationMessage | null;
  newTopic: boolean;
  setReplyTarget: (value: ConversationMessage | null) => void;
  setOptionsOpen: (value: boolean) => void;
  preparing: boolean;
  setNewTopic: (value: boolean) => void;
  draft: ComposeDraft | null;
  senderEmail?: string;
  subject: string;
  send: () => Promise<void>;
  sendError: string;
  notice: string;
  onOpenOutbox: () => void;
  aiSettings?: AiSettings;
  onAiChat?: (input: AiChatInput) => Promise<AiChatResult>;
  sourceMessage?: ConversationMessage;
};

export function ConversationComposer({
  replyInput,
  body,
  setBody,
  sending,
  text,
  replyTarget,
  newTopic,
  setReplyTarget,
  setOptionsOpen,
  preparing,
  setNewTopic,
  draft,
  senderEmail,
  subject,
  send,
  sendError,
  notice,
  onOpenOutbox,
  aiSettings,
  onAiChat,
  sourceMessage
}: ConversationComposerProps) {
  const [aiOpen, setAiOpen] = React.useState(false);
  return (
    <>
      {aiOpen && aiSettings && onAiChat && (
        <AiWritingCard
          key={`${newTopic}:${sourceMessage?.id ?? 'none'}`}
          body={body}
          setBody={setBody}
          sourceMessage={sourceMessage}
          newTopic={newTopic}
          settings={aiSettings}
          onChat={onAiChat}
          onClose={() => setAiOpen(false)}
        />
      )}
      <div className="conversation-composer mx-3 mb-3 shrink-0 rounded-2xl border px-3 py-2 md:mx-4">
        <Textarea
          ref={replyInput}
          value={body}
          disabled={sending}
          onChange={(event) => setBody(event.target.value)}
          rows={2}
          className="min-h-14 max-h-40 resize-none rounded-none border-0 bg-transparent px-0 py-2 shadow-none focus-visible:ring-0 dark:bg-transparent"
          placeholder={text("写下你的回复…", "Write your reply…")}
          aria-label={text("回复内容", "Reply text")}
        />
        {replyTarget && !newTopic && (
          <div
            role="group"
            aria-label={text("引用的邮件", "Quoted message")}
            className="mb-2 flex w-fit max-w-full items-center gap-2 text-xs text-muted-foreground"
          >
            <div className="min-w-0 max-w-xl flex-1 border-l-2 border-muted-foreground/35 pl-2.5">
              <p
                className="truncate leading-5"
                title={replyTarget.subject || text("无主题", "No subject")}
              >
                {replyTarget.subject || text("无主题", "No subject")}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-5 shrink-0 rounded-full bg-muted text-muted-foreground"
              disabled={sending}
              aria-label={text("取消引用", "Cancel quote")}
              onClick={() => {
                setReplyTarget(null);
                replyInput.current?.focus();
              }}
            >
              <X className="size-3" />
            </Button>
          </div>
        )}
        <div className="mt-1 flex min-h-8 items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1 text-xs">
            <Button
              className="h-7 px-1.5 text-xs text-muted-foreground"
              size="sm"
              variant="ghost"
              disabled={sending}
              onClick={() => setOptionsOpen(true)}
              aria-haspopup="dialog"
              aria-busy={preparing}
            >
              {preparing ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <SlidersHorizontal className="size-3.5" />
              )}
              {preparing
                ? text("加载中…", "Loading…")
                : text(
                    newTopic ? "新话题选项" : "发送选项",
                    newTopic ? "Topic options" : "Send options",
                  )}
            </Button>
            {!newTopic && (
              <Button
                className="h-7 px-1.5 text-xs text-muted-foreground"
                size="sm"
                variant="ghost"
                disabled={sending}
                onClick={() => {
                  setReplyTarget(null);
                  setNewTopic(true);
                  setOptionsOpen(true);
                }}
                aria-haspopup="dialog"
              >
                <Plus className="size-3.5" />
                {text("新话题", "New topic")}
              </Button>
            )}
            {aiSettings && onAiChat && (
              <Button
                className="h-7 px-1.5 text-xs text-muted-foreground"
                size="sm"
                variant="ghost"
                disabled={sending}
                aria-expanded={aiOpen}
                onClick={() => setAiOpen((open) => !open)}
              >
                <Sparkle className="size-3.5" aria-hidden="true" />
                {text("辅助写作", "Writing help")}
              </Button>
            )}
          </div>
          <div className="flex min-w-0 items-center justify-end gap-2">
            <Badge
              variant="outline"
              className="min-w-0 max-w-[min(42vw,18rem)] shrink border-border/60 bg-muted/30 text-muted-foreground"
              title={`${text("发件人", "From")}：${senderEmail || text("未选择发件账号", "No sending account")}`}
              aria-label={`${text("发件人", "From")}：${senderEmail || text("未选择发件账号", "No sending account")}`}
            >
              <Mail aria-hidden="true" />
              <span className="min-w-0 truncate">{senderEmail || text("未选择发件账号", "No sending account")}</span>
            </Badge>
            {body.trim() && (
              <Button
                className="conversation-send size-8 shrink-0 rounded-full"
                size="icon"
                disabled={
                  sending ||
                  preparing ||
                  !draft?.to.length ||
                  (newTopic && !subject.trim())
                }
                onClick={() => void send()}
                title={text("发送", "Send")}
                aria-label={
                  sending ? text("发送中", "Sending") : text("发送", "Send")
                }
              >
                {sending || preparing ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ArrowUp className="size-4" />
                )}
              </Button>
            )}
          </div>
        </div>
        {(sendError || notice) && (
          <div className="mt-2 break-words text-xs">
            {sendError && (
              <p role="alert" className="text-destructive">
                {sendError}
                <button className="ml-2 underline" onClick={onOpenOutbox}>
                  {text("查看发件箱", "View outbox")}
                </button>
              </p>
            )}
            {notice && (
              <p role="status" className="text-muted-foreground">
                {notice}
              </p>
            )}
          </div>
        )}
      </div>
    </>
  );
}

import { Loader2 } from 'lucide-react';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { ResponsiveDialog } from '@renderer/components/responsive-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@renderer/components/ui/select';
import type { Account } from '@renderer/components/mail/types';
import type { ConversationMessage, ConversationSummary } from '@renderer/shared/conversations';
import type { ComposeDraft } from '@renderer/lib/api';

type ConversationDialogsProps = {
  participantsOpen: boolean;
  setParticipantsOpen: (open: boolean) => void;
  optionsOpen: boolean;
  setOptionsOpen: (open: boolean) => void;
  conversation: ConversationSummary;
  text: (cn: string, en: string) => string;
  preparing: boolean;
  newTopic: boolean;
  setNewTopic: (value: boolean) => void;
  subject: string;
  setSubject: (value: string) => void;
  replyTarget: ConversationMessage | null;
  setReplyTarget: (value: ConversationMessage | null) => void;
  sending: boolean;
  draft: ComposeDraft | null;
  replyMessage: ConversationMessage | undefined;
  accounts: Account[];
  newAccountId: number | undefined;
  setNewAccountId: (value: number) => void;
  replyAll: boolean;
  setReplyAll: (value: boolean) => void;
  sendError: string;
};

export function ConversationDialogs({
  participantsOpen,
  setParticipantsOpen,
  optionsOpen,
  setOptionsOpen,
  conversation,
  text,
  preparing,
  newTopic,
  setNewTopic,
  subject,
  setSubject,
  replyTarget,
  setReplyTarget,
  sending,
  draft,
  replyMessage,
  accounts,
  newAccountId,
  setNewAccountId,
  replyAll,
  setReplyAll,
  sendError
}: ConversationDialogsProps) {
  return (
    <>
      <ResponsiveDialog
        open={participantsOpen}
        onOpenChange={setParticipantsOpen}
        title={text("参与者", "Participants")}
        contentClassName="flex max-h-[85dvh] flex-col gap-0 overflow-hidden p-0 md:max-w-md"
        headerClassName="shrink-0 px-4 py-3 pr-12 text-left"
        bodyClassName="min-h-0 overflow-y-auto px-4 py-2"
        footerClassName="shrink-0 border-t px-4 py-2"
        footer={
          <Button
            size="sm"
            variant="outline"
            onClick={() => setParticipantsOpen(false)}
          >
            {text("关闭", "Close")}
          </Button>
        }
      >
        <ul className="divide-y">
          {conversation.participants.map((participant) => (
            <li key={participant.email} className="min-w-0 py-2 text-sm">
              {participant.name && (
                <p className="font-medium break-words">{participant.name}</p>
              )}
              <p className="text-muted-foreground break-all">
                {participant.email}
              </p>
            </li>
          ))}
        </ul>
      </ResponsiveDialog>
      <ResponsiveDialog
        open={optionsOpen}
        onOpenChange={setOptionsOpen}
        title={text("发送选项", "Send options")}
        description={text(
          "查看收发件信息，设置本次回复或新话题。",
          "Review recipients and configure this reply or a new topic.",
        )}
        contentClassName="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 md:max-w-md"
        headerClassName="shrink-0 bg-muted/50 px-4 py-3 pr-12 text-left"
        bodyClassName="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3"
        footerClassName="shrink-0 bg-muted/50 px-4 py-2"
        footer={
          <Button
            size="sm"
            disabled={preparing || (newTopic && !subject.trim())}
            aria-busy={preparing}
            onClick={() => setOptionsOpen(false)}
          >
            {preparing && (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            )}
            {preparing ? text("加载中…", "Loading…") : text("完成", "Done")}
          </Button>
        }
      >
        <div className="space-y-1.5">
          <p className="text-xs font-medium">
            {text("发送方式", "Message type")}
          </p>
          <Select
            value={newTopic ? "new" : "reply"}
            onValueChange={(value) => {
              setNewTopic(value === "new");
              if (value === "new") setReplyTarget(null);
            }}
            disabled={sending}
          >
            <SelectTrigger
              className="w-full"
              aria-label={text("发送方式", "Message type")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="reply">
                {text(
                  replyTarget ? "回复引用邮件" : "回复当前话题",
                  replyTarget
                    ? "Reply to quoted message"
                    : "Reply to current topic",
                )}
              </SelectItem>
              <SelectItem value="new">{text("新话题", "New topic")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <p className="text-xs font-medium">{text("主题", "Subject")}</p>
          {newTopic ? (
            <Input
              value={subject}
              disabled={sending}
              onChange={(event) => setSubject(event.target.value)}
              placeholder={text("填写新话题主题", "Enter a subject")}
              aria-label={text("主题", "Subject")}
              required
            />
          ) : (
            <p className="break-words text-sm text-muted-foreground">
              {draft?.subject ||
                replyMessage?.subject ||
                text("无主题", "No subject")}
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <p className="text-xs font-medium">
            {text("发件账号", "Sending account")}
          </p>
          {newTopic ? (
            <Select
              value={newAccountId === undefined ? "" : String(newAccountId)}
              onValueChange={(value) => setNewAccountId(Number(value))}
              disabled={sending}
            >
              <SelectTrigger
                className="w-full"
                aria-label={text("发件账号", "Sending account")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {accounts
                  .filter((account) => account.accountId)
                  .map((account) => (
                    <SelectItem
                      key={account.id}
                      value={String(account.accountId)}
                    >
                      {account.address}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          ) : (
            <p className="break-all text-sm text-muted-foreground">
              {accounts.find(
                (account) => account.accountId === draft?.accountId,
              )?.address || "—"}
            </p>
          )}
        </div>
        {!newTopic &&
          conversation.isGroup &&
          replyMessage?.direction === "incoming" && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium">
                {text("回复范围", "Reply scope")}
              </p>
              <Select
                value={replyAll ? "all" : "sender"}
                onValueChange={(value) => setReplyAll(value === "all")}
                disabled={sending}
              >
                <SelectTrigger
                  className="w-full"
                  aria-label={text("回复范围", "Reply scope")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {text("回复所有人", "Reply all")}
                  </SelectItem>
                  <SelectItem value="sender">
                    {text("仅回复发件人", "Reply sender")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        <dl className="space-y-3 text-xs">
          <div>
            <dt className="mb-1 font-medium">{text("收件人", "To")}</dt>
            <dd className="break-all text-sm text-muted-foreground">
              {preparing
                ? text("正在准备…", "Preparing…")
                : draft?.to.join(", ") || "—"}
            </dd>
          </div>
          {Boolean(draft?.cc.length) && (
            <div>
              <dt className="mb-1 font-medium">{text("抄送", "Cc")}</dt>
              <dd className="break-all text-sm text-muted-foreground">
                {draft!.cc.join(", ")}
              </dd>
            </div>
          )}
        </dl>
        {sendError && (
          <p role="alert" className="text-xs text-destructive">
            {sendError}
          </p>
        )}
      </ResponsiveDialog>
    </>
  );
}

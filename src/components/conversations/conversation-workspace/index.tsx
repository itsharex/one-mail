import { useEffect, useRef } from "react";
import { formatAbsoluteTime, formatRelativeTime } from "@renderer/components/mail/date-format";
import { Loader2, MessageCircle, Plus, Search } from "lucide-react";
import { Button } from "@renderer/components/ui/button";
import { Input } from "@renderer/components/ui/input";
import { Account } from "@renderer/components/mail/types";
import { useI18n } from "@renderer/lib/i18n";
import { startWindowDrag } from "@renderer/lib/window-drag";
import { cn } from "@renderer/lib/utils";
import { useConversations } from "../use-conversations";
import { toast } from "sonner";
import { AppSettings } from "@renderer/shared/types";
import '../conversation-workspace.css';
import { ConversationPane } from './conversation-pane';
import { ConversationAvatar } from './conversation-avatar';

export type ConversationWorkspaceProps = {
  accounts: Account[];
  settings: AppSettings | null;
  accountId?: number;
  onCompose: () => void;
  onOpenOutbox: () => void;
  refreshKey?: number;
  openMessageId?: number | null;
  onOpenMessageHandled?: () => void;
};

export function ConversationWorkspace({
  accounts,
  settings,
  accountId,
  onCompose,
  onOpenOutbox,
  refreshKey,
  openMessageId,
  onOpenMessageHandled,
}: ConversationWorkspaceProps) {
  const { locale } = useI18n();
  const zh = locale === "zh-CN";
  const text = (cn: string, en: string) => (zh ? cn : en);
  const state = useConversations(accountId, refreshKey);
  const selected = state.selected;
  const listRoot = useRef<HTMLDivElement>(null);
  const loadMoreTarget = useRef<HTMLDivElement>(null);
  const openingMessageId = useRef<number | null>(null);

  useEffect(() => {
    if (!openMessageId) {
      openingMessageId.current = null;
      return;
    }
    if (openingMessageId.current === openMessageId) return;
    openingMessageId.current = openMessageId;
    void state.openMessage(openMessageId)
      .then((found) => {
        if (!found) toast.error(text("未找到该邮件", "Message no longer available"));
        onOpenMessageHandled?.();
      })
      .catch((error) => {
        console.warn('Failed to open notification message.', error);
        toast.error(text("无法打开该邮件", "Could not open message"));
        onOpenMessageHandled?.();
      });
  }, [openMessageId, onOpenMessageHandled, state.openMessage]);

  useEffect(() => {
    if (
      !state.hasMore ||
      state.loading ||
      state.error ||
      !listRoot.current ||
      !loadMoreTarget.current
    )
      return;
    let triggered = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (triggered || !entries.some((entry) => entry.isIntersecting)) return;
        triggered = true;
        observer.disconnect();
        state.loadMore();
      },
      { root: listRoot.current, rootMargin: "0px 0px 300px 0px" },
    );
    observer.observe(loadMoreTarget.current);
    return () => {
      triggered = true;
      observer.disconnect();
    };
  }, [state.hasMore, state.loading, state.error, state.loadMore]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <section
        className={cn(
          "conversation-list flex w-full shrink-0 flex-col border-r md:w-72 lg:w-80",
          selected && "hidden md:flex",
        )}
      >
        <div
          className="app-drag-region flex h-12 shrink-0 items-center justify-between px-3"
          onMouseDown={startWindowDrag}
        >
          <h2 className="font-semibold">{text("对话", "Conversations")}</h2>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={onCompose}
              title={text("新对话", "New conversation")}
              aria-label={text("新对话", "New conversation")}
            >
              <Plus className="size-4" />
            </Button>
          </div>
        </div>
        <div className="conversation-search relative mx-3 mb-2">
          <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <Input
            className="pl-9"
            value={state.keyword}
            onChange={(event) => state.setKeyword(event.target.value)}
            placeholder={text("搜索联系人或邮箱", "Search people or email")}
            aria-label={text("搜索联系人或邮箱", "Search people or email")}
          />
        </div>
        <div ref={listRoot} className="min-h-0 flex-1 overflow-y-auto pb-2">
          {state.error && (
            <p role="alert" className="p-3 text-sm text-destructive">
              {state.error}
              <Button variant="ghost" size="sm" onClick={state.refresh}>
                {text("重试", "Retry")}
              </Button>
            </p>
          )}
          {state.loading && state.conversations.length === 0 && (
            <div
              role="status"
              className="flex items-center justify-center gap-2 py-3 text-xs text-muted-foreground"
            >
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              {text("加载中…", "Loading…")}
            </div>
          )}
          {!state.loading &&
            !state.error &&
            state.conversations.length === 0 && (
              <p className="p-4 text-center text-sm text-muted-foreground">
                {text("暂无对话", "No conversations yet")}
              </p>
            )}
          {state.conversations.map((item) => (
            <button
              key={item.conversationId}
              type="button"
              aria-current={
                selected?.conversationId === item.conversationId
                  ? "true"
                  : undefined
              }
              onClick={() => state.setSelectedId(item.conversationId)}
              className={cn(
                "conversation-row flex w-full items-center gap-2.5 px-3.5 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                selected?.conversationId === item.conversationId &&
                  "is-selected",
              )}
            >
              <div className="relative shrink-0">
                <ConversationAvatar
                  seed={item.participants[0]?.email || item.conversationId}
                  members={item.isGroup ? item.participants : undefined}
                  iconUrl={item.isGroup ? item.iconUrl : undefined}
                  compact
                />
                {item.unreadCount > 0 && (
                  <span
                    className="conversation-unread absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] tabular-nums"
                    aria-label={text(
                      `${item.unreadCount} 条未读`,
                      `${item.unreadCount} unread messages`,
                    )}
                  >
                    {item.unreadCount > 99 ? "99+" : item.unreadCount}
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span
                    className="min-w-0 flex-1 truncate text-sm font-medium"
                    title={item.displayName}
                  >
                    {item.displayName}
                  </span>
                  <time
                    dateTime={item.lastMessage.receivedAt}
                    title={formatAbsoluteTime(item.lastMessage.receivedAt)}
                    className="shrink-0 whitespace-nowrap text-[11px] text-muted-foreground"
                  >
                    {formatRelativeTime(item.lastMessage.receivedAt, locale)}
                  </time>
                </div>
                <p
                  className="mt-0.5 truncate text-xs leading-4 text-muted-foreground"
                  title={
                    item.lastMessage.snippet ||
                    item.lastMessage.subject ||
                    text("无主题", "No subject")
                  }
                >
                  {item.lastMessage.snippet ||
                    item.lastMessage.subject ||
                    text("无主题", "No subject")}
                </p>
              </div>
            </button>
          ))}
          <div ref={loadMoreTarget} className="min-h-px">
            {state.loading && state.conversations.length > 0 && (
              <div
                role="status"
                className="flex items-center justify-center gap-2 py-3 text-xs text-muted-foreground"
              >
                <Loader2 className="size-4 animate-spin" />
                {text("加载中…", "Loading…")}
              </div>
            )}
          </div>
        </div>
      </section>
      {selected ? (
        <ConversationPane
          key={`${accountId ?? "all"}:${selected.conversationId}`}
          conversation={selected}
          settings={settings}
          messages={state.messages}
          focusedMessageId={state.focusedMessageId}
          accounts={accounts}
          loading={state.loadingMessages}
          error={state.messageError}
          hasOlder={state.hasOlder}
          loadOlder={state.loadOlder}
          onBack={() => state.setSelectedId(null)}
          onOpenOutbox={onOpenOutbox}
          refresh={state.refresh}
        />
      ) : (
        <div className="conversation-empty hidden flex-1 flex-col text-muted-foreground md:flex">
          <div
            className="app-drag-region h-12 shrink-0"
            onMouseDown={startWindowDrag}
          />
          <div className="flex flex-1 flex-col items-center justify-center gap-4">
            <MessageCircle className="size-16 stroke-1 opacity-25" />
            <p className="text-sm">
              {text(
                "选择一个人，继续交流",
                "Choose a person to continue the conversation",
              )}
            </p>
            <Button variant="outline" onClick={onCompose}>
              {text("发起对话", "Start a conversation")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { invoke } from '@tauri-apps/api/core';
import { emitTo, listen } from '@tauri-apps/api/event';
import { formatAbsoluteTime, formatRelativeTime } from "@renderer/components/mail/date-format";
import { Loader2, MessageCircle, Plus, Search } from "lucide-react";
import { Button } from "@renderer/components/ui/button";
import { Badge } from "@renderer/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@renderer/components/ui/dropdown-menu";
import { Skeleton } from "@renderer/components/ui/skeleton";
import { CopyButton } from "@renderer/components/ui/copy-button";
import { Account } from "@renderer/components/mail/types";
import { useI18n } from "@renderer/lib/i18n";
import { startWindowDrag } from "@renderer/lib/window-drag";
import { cn } from "@renderer/lib/utils";
import { useConversations, type ConversationTimeFilter } from "../use-conversations";
import { toast } from "sonner";
import type { AiChatInput, AiChatResult, AiSettings, AppSettings } from "@renderer/shared/types";
import type { ConversationAddress, ConversationMessage } from "@renderer/shared/conversations";
import '../conversation-workspace.css';
import { ConversationPane } from './conversation-pane';
import { ConversationAvatar } from './conversation-avatar';
import { GlobalSearchDialog } from './global-search-dialog';

export type ConversationWorkspaceProps = {
  accounts: Account[];
  settings: AppSettings | null;
  accountId?: number;
  databasePath?: string;
  onSelectAccount: (accountId: string) => void;
  onAddAccount: () => void;
  onCompose: () => void;
  onOpenOutbox: () => void;
  refreshKey?: number;
  openMessageId?: number | null;
  onOpenMessageHandled?: () => void;
  aiSettings?: AiSettings;
  onAiChat?: (input: AiChatInput) => Promise<AiChatResult>;
};

function participantLabel(person: ConversationAddress): string {
  const name = person.name?.trim();
  if (name && name.toLowerCase() !== person.email.toLowerCase()) return name;
  const domain = person.email.split("@")[1]?.split(".");
  return domain?.at(-2) || domain?.[0] || person.email;
}

export function ConversationWorkspace({
  accounts,
  settings,
  accountId,
  databasePath,
  onSelectAccount,
  onAddAccount,
  onCompose,
  onOpenOutbox,
  refreshKey,
  openMessageId,
  onOpenMessageHandled,
  aiSettings,
  onAiChat,
}: ConversationWorkspaceProps) {
  const { locale } = useI18n();
  const zh = locale === "zh-CN";
  const text = (cn: string, en: string) => (zh ? cn : en);
  const state = useConversations(accountId, refreshKey);
  const [searchOpen, setSearchOpen] = useState(false);
  const selected = state.selected;
  const timeFilters: { value: ConversationTimeFilter; label: string }[] = [
    { value: "all", label: text("全部时间", "All time") },
    { value: "today", label: text("今天", "Today") },
    { value: "yesterday", label: text("昨天", "Yesterday") },
    { value: "last3", label: text("近三天", "Last 3 days") },
  ];
  const listRoot = useRef<HTMLDivElement>(null);
  const loadMoreTarget = useRef<HTMLDivElement>(null);
  const openingMessageId = useRef<number | null>(null);
  const originalMessage = useRef<ConversationMessage | null>(null);

  useEffect(() => {
    let active = true;
    let stop: (() => void) | undefined;
    void listen('original/ready', () => {
      if (originalMessage.current) void emitTo('original-message', 'original/message', originalMessage.current)
        .catch((reason) => console.warn('Failed to send original message.', reason));
    }).then((unlisten) => { if (active) stop = unlisten; else unlisten(); })
      .catch((reason) => console.warn('Failed to listen for original message window.', reason));
    return () => { active = false; stop?.(); };
  }, []);

  function openOriginal(message: ConversationMessage): void {
    originalMessage.current = message;
    void invoke('original_message_open_window', { subject: message.subject })
      .then(() => emitTo('original-message', 'original/message', message))
      .catch((reason) => toast.error(String(reason)));
  }

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
          className="app-drag-region flex h-10 shrink-0 items-center gap-1.5 px-3"
          onMouseDown={startWindowDrag}
        >
          <button type="button" className="app-no-drag flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border bg-background px-2.5 text-left text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring" onClick={() => setSearchOpen(true)} aria-label={text("全局搜索", "Search all mail")}>
            <Search className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{text("搜索全部邮件", "Search all mail")}</span>
            <kbd className="ml-auto hidden shrink-0 rounded border px-1 text-[10px] sm:inline-flex">⌘ K</kbd>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label={text("新增", "Add")}
              >
                <Plus className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              <DropdownMenuItem onSelect={onAddAccount}>
                {text("新增厂商", "Add email provider")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onCompose}>
                {text("新增对话发邮件", "Start a conversation and send email")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div role="radiogroup" aria-label={text("按时间筛选对话", "Filter conversations by time")} className="mx-3 mb-1 flex flex-wrap gap-0.5">
          {timeFilters.map((option) => {
            const active = state.timeFilter === option.value;
            return (
              <Badge
                key={option.value}
                asChild
                variant={active ? "default" : "outline"}
                className={cn(
                  "h-6 cursor-pointer rounded-full px-2.5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                  active
                    ? "hover:bg-primary/90"
                    : "border-border/70 bg-background/50 text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <label>
                  <input
                    className="sr-only"
                    type="radio"
                    name="conversation-time-filter"
                    value={option.value}
                    checked={active}
                    onChange={() => state.setTimeFilter(option.value)}
                  />
                  {option.label}
                </label>
              </Badge>
            );
          })}
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
            <div role="status" aria-label={text("加载对话中", "Loading conversations")} className="space-y-1 px-3 py-2">
              {Array.from({ length: 6 }, (_, index) => <div key={index} className="flex items-center gap-3 py-2">
                <Skeleton className="size-9 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1 space-y-2"><Skeleton className="h-3 w-3/5" /><Skeleton className="h-2.5 w-4/5" /></div>
              </div>)}
            </div>
          )}
          {!state.loading &&
            !state.error &&
            state.conversations.length === 0 && (
              <p className="p-4 text-center text-sm text-muted-foreground">
                {state.keyword
                  ? text("没有找到匹配的对话", "No matching conversations")
                  : state.timeFilter !== 'all'
                  ? text("该时间段暂无对话", "No conversations in this time range")
                  : text("暂无对话", "No conversations yet")}
              </p>
            )}
          {state.conversations.map((item) => (
            <div
              key={item.conversationId}
              className={cn(
                "conversation-row relative flex w-full items-center gap-2.5 px-3.5 py-2 text-left",
                selected?.conversationId === item.conversationId &&
                  "is-selected",
              )}
            >
              <button
                type="button"
                className="absolute inset-0 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                aria-current={selected?.conversationId === item.conversationId ? "true" : undefined}
                aria-label={item.participants.map((person) => person.email).join(', ')}
                onClick={() => state.setSelectedId(item.conversationId)}
              />
              <div className="pointer-events-none relative shrink-0">
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
              <div className="pointer-events-none relative min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <div className="group/brand pointer-events-auto flex min-w-0 items-center gap-1">
                    <button
                      type="button"
                      className="min-w-0 truncate text-left text-sm font-medium"
                      title={item.participants.map(participantLabel).join(", ")}
                      onClick={() => state.setSelectedId(item.conversationId)}
                    >
                      {item.participants.map(participantLabel).join(", ")}
                    </button>
                    <CopyButton
                      value={item.participants.map((person) => person.email).join(', ')}
                      variant="ghost"
                      size="icon-xs"
                      title={text("复制邮箱", "Copy email")}
                      className="size-5 opacity-0 transition-opacity group-hover/brand:opacity-100 group-focus-within/brand:opacity-100 [@media(hover:none)]:opacity-100"
                    />
                  </div>
                  <time
                    dateTime={item.lastMessage.receivedAt}
                    title={formatAbsoluteTime(item.lastMessage.receivedAt)}
                    className="ml-auto shrink-0 whitespace-nowrap text-[11px] text-muted-foreground"
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
            </div>
          ))}
          <div ref={loadMoreTarget} className="min-h-px">
            {state.loadingMore && (
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
          aiSettings={aiSettings}
          onAiChat={onAiChat}
          settings={settings}
          messages={state.messages}
          focusedMessageId={state.focusedMessageId}
          focusToken={state.focusToken}
          accounts={accounts}
          loading={state.loadingMessages}
          loadingOlder={state.loadingOlder}
          error={state.messageError}
          hasOlder={state.hasOlder}
          loadOlder={state.loadOlder}
          onBack={() => state.setSelectedId(null)}
          onOpenOutbox={onOpenOutbox}
          onOpenOriginal={openOriginal}
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
      <GlobalSearchDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        accounts={accounts}
        databasePath={databasePath}
        onNavigate={(result) => {
          state.openSearchResult(result);
          onSelectAccount(String(result.message.accountId));
        }}
      />
    </div>
  );
}

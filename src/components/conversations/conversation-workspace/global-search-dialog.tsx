import { useEffect, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Command } from 'cmdk'
import { Database, Loader2, Search } from 'lucide-react'
import { toast } from 'sonner'
import { formatAbsoluteTime } from '@renderer/components/mail/date-format'
import type { Account } from '@renderer/components/mail/types'
import { Button } from '@renderer/components/ui/button'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@renderer/components/ui/context-menu'
import { Dialog, DialogContent, DialogTitle } from '@renderer/components/ui/dialog'
import { useI18n } from '@renderer/lib/i18n'
import type { ConversationSearchResult } from '@renderer/shared/conversations'

const PAGE_SIZE = 40

function Highlight({ value, keyword }: { value: string; keyword: string }) {
  if (!keyword) return value
  const pattern = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
  const matches = Array.from(value.matchAll(pattern))
  if (matches.length === 0) return value
  let cursor = 0
  return <>{matches.map((match) => {
    const start = match.index
    const before = value.slice(cursor, start)
    cursor = start + match[0].length
    return <span key={start}>{before}<mark className="rounded-sm bg-amber-200 px-0.5 text-amber-950 dark:bg-amber-500/40 dark:text-amber-100">{match[0]}</mark></span>
  })}{value.slice(cursor)}</>
}

export function GlobalSearchDialog({ open, onOpenChange, accounts, databasePath, onNavigate }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  accounts: Account[]
  databasePath?: string
  onNavigate: (result: ConversationSearchResult) => void
}) {
  const { locale } = useI18n()
  const text = (cn: string, en: string) => locale === 'zh-CN' ? cn : en
  const [input, setInput] = useState('')
  const [keyword, setKeyword] = useState('')
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        onOpenChange(!open)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onOpenChange])
  useEffect(() => {
    const timer = setTimeout(() => setKeyword(input.trim()), 250)
    return () => clearTimeout(timer)
  }, [input])
  const search = useInfiniteQuery({
    queryKey: ['conversations', 'search', keyword],
    enabled: open && keyword.length > 0,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => window.api.conversations.search(keyword, PAGE_SIZE, pageParam),
    getNextPageParam: (last, pages) => last.length === PAGE_SIZE ? pages.length * PAGE_SIZE : undefined,
  })
  const results = search.data?.pages.flat() ?? []
  const databaseAction = text('打开数据库目录', 'Open database folder')
  const showDatabaseAction = Boolean(databasePath) && databaseAction.toLocaleLowerCase().includes(input.trim().toLocaleLowerCase())
  const navigate = (result: ConversationSearchResult) => {
    onNavigate(result)
    onOpenChange(false)
  }
  const openDatabase = () => {
    onOpenChange(false)
    void window.api.system.openDatabaseDirectory().catch(() => toast.error(text('无法打开数据库目录', 'Could not open the database folder')))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-workspace="conversations" showCloseButton={false} className="max-h-[min(80vh,640px)] max-w-xl gap-0 overflow-hidden rounded-xl p-0 shadow-2xl">
        <DialogTitle className="sr-only">{text('全局搜索', 'Search all mail')}</DialogTitle>
        <Command shouldFilter={false} loop className="global-search-command flex min-h-0 flex-col bg-background text-foreground">
          <div className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
            <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <Command.Input
              autoFocus
              value={input}
              onValueChange={setInput}
              className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              placeholder={text('搜索联系人、主题或邮件内容…', 'Search people, subjects, or messages…')}
              aria-label={text('搜索关键词', 'Search keyword')}
            />
            <kbd className="shrink-0 rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground">ESC</kbd>
          </div>
          <Command.List className="min-h-24 max-h-[min(58vh,480px)] overflow-y-auto p-2" aria-live="polite">
            {showDatabaseAction && <Command.Group heading={text('快捷操作', 'Quick actions')}>
              <Command.Item value="open-database-directory" onSelect={openDatabase} className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 outline-none data-[selected=true]:bg-accent">
                <Database className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0"><span className="block text-sm font-medium">{databaseAction}</span><span className="block truncate text-[11px] text-muted-foreground" title={databasePath}>{databasePath}</span></span>
              </Command.Item>
            </Command.Group>}
            {!keyword && <p className="py-7 text-center text-sm text-muted-foreground">{text('搜索邮件，或选择快捷操作', 'Search mail or choose a quick action')}</p>}
            {keyword && search.isPending && <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{text('搜索中…', 'Searching…')}</p>}
            {keyword && search.isError && <p role="alert" className="py-8 text-center text-sm text-destructive">{text('搜索失败，请重试', 'Search failed. Try again.')} <Button variant="ghost" size="sm" onClick={() => void search.refetch()}>{text('重试', 'Retry')}</Button></p>}
            {keyword && !search.isPending && !search.isError && results.length === 0 && !showDatabaseAction && <p className="py-10 text-center text-sm text-muted-foreground">{text('没有找到匹配的消息', 'No matching messages')}</p>}
            {results.length > 0 && <Command.Group heading={text('搜索结果', 'Results')}>
              {results.map((result) => {
                const account = accounts.find((item) => item.accountId === result.message.accountId)
                return <ContextMenu key={result.message.id}>
                  <ContextMenuTrigger asChild>
                    <Command.Item value={result.message.id} onSelect={() => navigate(result)} className="flex cursor-pointer flex-col gap-1 rounded-md px-3 py-2.5 text-left outline-none data-[selected=true]:bg-accent">
                      <span className="flex w-full items-center gap-2 text-sm">
                        <strong className="min-w-0 flex-1 truncate"><Highlight value={result.conversation.displayName} keyword={keyword} /></strong>
                        <time className="shrink-0 text-xs text-muted-foreground" dateTime={result.message.receivedAt}>{formatAbsoluteTime(result.message.receivedAt)}</time>
                      </span>
                      <span className="line-clamp-1 text-xs font-medium"><Highlight value={result.message.subject || text('无主题', 'No subject')} keyword={keyword} /></span>
                      {result.excerpt && <span className="line-clamp-2 text-xs text-muted-foreground"><Highlight value={result.excerpt} keyword={keyword} /></span>}
                      <span className="truncate text-[11px] text-muted-foreground">{[account?.providerKey, account?.name, account?.address].filter(Boolean).join(' · ') || result.message.fromEmail}</span>
                    </Command.Item>
                  </ContextMenuTrigger>
                  <ContextMenuContent><ContextMenuItem onSelect={() => navigate(result)}>{text('切换账号并定位消息', 'Switch account and locate message')}</ContextMenuItem></ContextMenuContent>
                </ContextMenu>
              })}
            </Command.Group>}
            {search.hasNextPage && <Button variant="ghost" className="my-1 w-full" disabled={search.isFetchingNextPage} onClick={() => void search.fetchNextPage()}>{search.isFetchingNextPage ? text('加载中…', 'Loading…') : text('加载更多', 'Load more')}</Button>}
          </Command.List>
          <div className="flex h-9 shrink-0 items-center justify-between border-t px-4 text-[11px] text-muted-foreground">
            <span>{text('↑↓ 选择  ·  ↵ 打开', '↑↓ Navigate  ·  ↵ Open')}</span>
            <span>{text('ESC 关闭', 'ESC Close')}</span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  )
}

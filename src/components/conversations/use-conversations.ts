import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import type { ConversationLocation, ConversationSearchResult } from '@renderer/shared/conversations'

const PAGE_SIZE = 40
const STALE_TIME = 30_000
export type ConversationTimeFilter = 'all' | 'today' | 'yesterday' | 'last3'

export function useConversations(accountId?: number, refreshKey?: number) {
  const client = useQueryClient()
  const [keyword, setKeyword] = useState('')
  const [search, setSearch] = useState('')
  const [timeFilter, setTimeFilter] = useState<ConversationTimeFilter>('today')
  const [calendarDay, setCalendarDay] = useState(() => new Date().toDateString())
  const [selection, setSelection] = useState<{ scope: string; id: string | null } | null>(null)
  const [targetLocation, setTargetLocation] = useState<ConversationLocation | null>(null)
  const [focusedMessageId, setFocusedMessageId] = useState<string | null>(null)
  const [focusToken, setFocusToken] = useState(0)
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const dateRange = useMemo(() => {
    if (timeFilter === 'all') return null
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const dayStart = (offset: number) => {
      const date = new Date(today)
      date.setDate(date.getDate() + offset)
      return date.getTime()
    }
    if (timeFilter === 'today') return { receivedFromMs: dayStart(0), receivedBeforeMs: dayStart(1) }
    if (timeFilter === 'yesterday') return { receivedFromMs: dayStart(-1), receivedBeforeMs: dayStart(0) }
    return { receivedFromMs: dayStart(-2), receivedBeforeMs: dayStart(1) }
  }, [timeFilter, calendarDay])
  const scope = `${accountId ?? 'all'}:${search}:${timeFilter}`

  useEffect(() => {
    if (timeFilter === 'all') return
    const now = new Date()
    const tomorrow = new Date(now)
    tomorrow.setHours(24, 0, 0, 0)
    const timer = setTimeout(() => setCalendarDay(tomorrow.toDateString()), tomorrow.getTime() - now.getTime())
    return () => clearTimeout(timer)
  }, [timeFilter, calendarDay])

  useEffect(() => {
    const timer = setTimeout(() => setSearch(keyword), keyword ? 250 : 0)
    return () => clearTimeout(timer)
  }, [keyword])

  const list = useInfiniteQuery({
    queryKey: ['conversations', 'list', accountId ?? null, search, dateRange?.receivedFromMs ?? null, dateRange?.receivedBeforeMs ?? null, refreshKey ?? 0],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => window.api.conversations.list({ accountId, keyword: search, ...(dateRange ?? {}), limit: PAGE_SIZE, offset: pageParam }),
    getNextPageParam: (last, pages) => last.length === PAGE_SIZE ? pages.length * PAGE_SIZE : undefined,
    staleTime: STALE_TIME
  })
  const conversations = useMemo(() => list.data?.pages.flat() ?? [], [list.data])
  const selectedId = selection?.scope === scope ? selection.id : null
  const selected = conversations.find((item) => item.conversationId === selectedId) ??
    (targetLocation?.conversation.conversationId === selectedId ? targetLocation.conversation : null)
  const setSelectedId = useCallback((id: string | null) => {
    setTargetLocation(null)
    setFocusedMessageId(null)
    setSelection({ scope, id })
  }, [scope])
  const openMessage = useCallback(async (messageId: number): Promise<boolean> => {
    const location = await window.api.conversations.findMessage(messageId)
    if (!location) return false
    setKeyword('')
    setSearch('')
    setTimeFilter('all')
    setTargetLocation(location)
    setFocusedMessageId(`message:${messageId}`)
    setFocusToken((current) => current + 1)
    setSelection({ scope: `${accountId ?? 'all'}::all`, id: location.conversation.conversationId })
    return true
  }, [accountId])

  const openSearchResult = useCallback((result: ConversationSearchResult) => {
    setKeyword('')
    setSearch('')
    setTimeFilter('all')
    setTargetLocation(result)
    setFocusedMessageId(result.message.id)
    setFocusToken((current) => current + 1)
    setSelection({ scope: `${result.message.accountId}::all`, id: result.conversation.conversationId })
  }, [])

  const timeline = useInfiniteQuery({
    queryKey: ['conversations', 'messages', accountId ?? null, selectedId, focusedMessageId, refreshKey ?? 0],
    enabled: selectedId !== null,
    initialPageParam: focusedMessageId && targetLocation?.conversation.conversationId === selectedId
      ? Math.floor(targetLocation.offset / PAGE_SIZE) * PAGE_SIZE : 0,
    queryFn: ({ pageParam }) => window.api.conversations.messages({ conversationId: selectedId!, accountId, limit: PAGE_SIZE, offset: pageParam }),
    getNextPageParam: (last, _pages, lastPageParam) => last.length === PAGE_SIZE ? lastPageParam + PAGE_SIZE : undefined,
    staleTime: STALE_TIME
  })
  const messages = useMemo(() => timeline.data?.pages.flat() ?? [], [timeline.data])

  const refresh = useCallback(() => {
    if (refreshTimer.current) return
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = undefined
      void client.invalidateQueries({ queryKey: ['conversations'] }, { cancelRefetch: false })
    }, 250)
  }, [client])
  useEffect(() => () => {
    if (refreshTimer.current) {
      clearTimeout(refreshTimer.current)
      void client.invalidateQueries({ queryKey: ['conversations'], refetchType: 'none' })
    }
  }, [client])

  const loadMore = useCallback(() => {
    if (list.hasNextPage && !list.isFetching && !list.error) void list.fetchNextPage()
  }, [list.hasNextPage, list.isFetching, list.error, list.fetchNextPage])
  const loadOlder = useCallback(() => {
    if (timeline.hasNextPage && !timeline.isFetching) void timeline.fetchNextPage()
  }, [timeline.hasNextPage, timeline.isFetching, timeline.fetchNextPage])

  return {
    keyword, setKeyword, timeFilter, setTimeFilter, selectedId, selected, setSelectedId, openMessage, openSearchResult, focusedMessageId, focusToken, conversations, messages,
    loading: list.isPending, loadingMore: list.isFetchingNextPage,
    loadingMessages: timeline.isPending, loadingOlder: timeline.isFetchingNextPage,
    error: list.error ? String(list.error) : '',
    messageError: timeline.error ? String(timeline.error) : '',
    refresh, hasMore: list.hasNextPage, hasOlder: timeline.hasNextPage, loadMore, loadOlder
  }
}

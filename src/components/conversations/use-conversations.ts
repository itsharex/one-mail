import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import type { ConversationLocation } from '@renderer/shared/conversations'

const PAGE_SIZE = 40
const STALE_TIME = 30_000

export function useConversations(accountId?: number, refreshKey?: number) {
  const client = useQueryClient()
  const [keyword, setKeyword] = useState('')
  const [search, setSearch] = useState('')
  const [selection, setSelection] = useState<{ scope: string; id: string | null } | null>(null)
  const [targetLocation, setTargetLocation] = useState<ConversationLocation | null>(null)
  const [focusedMessageId, setFocusedMessageId] = useState<number | null>(null)
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const scope = `${accountId ?? 'all'}:${search}`

  useEffect(() => {
    const timer = setTimeout(() => setSearch(keyword), keyword ? 250 : 0)
    return () => clearTimeout(timer)
  }, [keyword])

  const list = useInfiniteQuery({
    queryKey: ['conversations', 'list', accountId ?? null, search, refreshKey ?? 0],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => window.api.conversations.list({ accountId, keyword: search, limit: PAGE_SIZE, offset: pageParam }),
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
    setTargetLocation(location)
    setFocusedMessageId(messageId)
    setSelection({ scope: `${accountId ?? 'all'}:`, id: location.conversation.conversationId })
    return true
  }, [accountId])

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
    keyword, setKeyword, selectedId, selected, setSelectedId, openMessage, focusedMessageId, conversations, messages,
    loading: list.isFetching, loadingMessages: timeline.isFetching,
    error: list.error ? String(list.error) : '',
    messageError: timeline.error ? String(timeline.error) : '',
    refresh, hasMore: list.hasNextPage, hasOlder: timeline.hasNextPage, loadMore, loadOlder
  }
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'

const PAGE_SIZE = 40
const STALE_TIME = 30_000

export function useConversations(accountId?: number, refreshKey?: number) {
  const client = useQueryClient()
  const [keyword, setKeyword] = useState('')
  const [search, setSearch] = useState('')
  const [selection, setSelection] = useState<{ scope: string; id: string | null } | null>(null)
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
  const selectedId = selection?.scope === scope && conversations.some((item) => item.conversationId === selection.id)
    ? selection.id : null
  const setSelectedId = useCallback((id: string | null) => setSelection({ scope, id }), [scope])

  const timeline = useInfiniteQuery({
    queryKey: ['conversations', 'messages', accountId ?? null, selectedId, refreshKey ?? 0],
    enabled: selectedId !== null,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => window.api.conversations.messages({ conversationId: selectedId!, accountId, limit: PAGE_SIZE, offset: pageParam }),
    getNextPageParam: (last, pages) => last.length === PAGE_SIZE ? pages.length * PAGE_SIZE : undefined,
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
    keyword, setKeyword, selectedId, setSelectedId, conversations, messages,
    loading: list.isFetching, loadingMessages: timeline.isFetching,
    error: list.error ? String(list.error) : '',
    messageError: timeline.error ? String(timeline.error) : '',
    refresh, hasMore: list.hasNextPage, hasOlder: timeline.hasNextPage, loadMore, loadOlder
  }
}

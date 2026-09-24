import * as React from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

import type { Account } from '@renderer/components/mail/types'
import { useI18n, type AppLocale, type TranslationKey } from '@renderer/lib/i18n'

export type NetworkRequest = { id: number; kind: string; accountId?: number; startedAt: number }
export type CompletedNetworkRequest = NetworkRequest & { finishedAt: number; durationMs: number }
type NetworkSnapshot = { revision: number; requests: NetworkRequest[]; recent: CompletedNetworkRequest[] }

const requestLabels: Record<string, TranslationKey> = {
  ai: 'status.requestAi',
  body: 'status.requestBody',
  folders: 'status.requestFolders',
  icon: 'status.requestIcon',
  'imap-monitor': 'status.requestImapMonitor',
  oauth: 'status.requestOAuth',
  send: 'status.requestSend',
  sync: 'status.requestSync'
}

export function formatNetworkDuration(milliseconds: number, locale: AppLocale): string {
  const elapsed = Math.max(0, Math.floor(milliseconds))
  if (elapsed < 1000) return `${elapsed} ms`
  if (elapsed < 60_000) return `${(elapsed / 1000).toFixed(1)} s`
  if (elapsed >= 3_600_000) {
    const hours = Math.floor(elapsed / 3_600_000)
    const minutes = Math.floor((elapsed % 3_600_000) / 60_000)
    return locale === 'zh-CN' ? `${hours} 小时 ${minutes} 分` : `${hours} h ${minutes} min`
  }
  const minutes = Math.floor(elapsed / 60_000)
  const seconds = Math.floor((elapsed % 60_000) / 1000)
  return locale === 'zh-CN' ? `${minutes} 分 ${seconds} 秒` : `${minutes} min ${seconds} s`
}

export function useNetworkActivity(): { requests: NetworkRequest[]; recent: CompletedNetworkRequest[]; connection: 'loading' | 'ready' | 'error'; now: number } {
  const [snapshot, setSnapshot] = React.useState<NetworkSnapshot>({ revision: 0, requests: [], recent: [] })
  const [connection, setConnection] = React.useState<'loading' | 'ready' | 'error'>('loading')
  const [now, setNow] = React.useState(Date.now)
  const requests = snapshot.requests
  React.useEffect(() => {
    let active = true
    let unlisten: UnlistenFn | undefined
    const apply = (next: NetworkSnapshot): void => {
      if (active) {
        setSnapshot((current) => next.revision >= current.revision ? next : current)
        setConnection('ready')
        setNow(Date.now())
      }
    }
    void listen<NetworkSnapshot>('network/activity', (event) => apply(event.payload))
      .then((stop) => {
        if (!active) { stop(); return }
        unlisten = stop
        return invoke<NetworkSnapshot>('network_activity_status').then(apply)
      })
      .catch(() => { if (active) setConnection('error') })
    return () => { active = false; unlisten?.() }
  }, [])

  React.useEffect(() => {
    if (requests.length === 0) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [requests.length])

  return { requests, recent: snapshot.recent ?? [], connection, now }
}

export function getNetworkRequestDisplay(request: NetworkRequest, accounts: Account[], t: ReturnType<typeof useI18n>['t']): { account: string; action: string } {
  const account = accounts.find((item) => item.accountId === request.accountId)
  const action = t(requestLabels[request.kind] ?? 'status.requestOther')
  return { account: account?.address ?? '', action }
}

export function formatNetworkRequestName(request: NetworkRequest, accounts: Account[], t: ReturnType<typeof useI18n>['t']): string {
  const { account, action } = getNetworkRequestDisplay(request, accounts, t)
  return account ? `${account} · ${action}` : action
}

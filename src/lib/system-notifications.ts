import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

import type { NewMailNotification } from '@renderer/shared/types'

type NotificationPlatform = 'macos' | 'windows' | 'linux'
type NativeNotificationOptions = {
  title: string
  body?: string
  group?: string
  sound?: string
  messageId?: number
  providerKey?: string
}

export type NewMailNotificationCopy = {
  title: string
  countTitle: string
  noSubject: string
  unknownSender: string
}

export function buildNewMailNotificationOptions(
  notification: NewMailNotification,
  copy: NewMailNotificationCopy,
  platform: NotificationPlatform
): NativeNotificationOptions {
  const firstMessage = notification.messages.reduce((latest, message) => {
    const currentTime = Date.parse(message.receivedAt ?? '')
    const latestTime = Date.parse(latest?.receivedAt ?? '')
    return !latest || (Number.isFinite(currentTime) && (!Number.isFinite(latestTime) || currentTime > latestTime))
      ? message : latest
  }, notification.messages[0])
  const sound =
    platform === 'macos' ? 'Ping' : platform === 'windows' ? 'Mail' : 'message-new-instant'

  if (notification.messageCount === 1 && firstMessage) {
    return {
      title: firstMessage.fromName?.trim() || firstMessage.fromEmail?.trim() || copy.unknownSender,
      body: firstMessage.subject?.trim() || copy.noSubject,
      group: `onemail-account-${notification.accountId}`,
      sound,
      messageId: firstMessage.messageId
    }
  }

  const body = notification.messages
    .slice(0, 3)
    .map((message) => {
      const sender = message.fromName?.trim() || message.fromEmail?.trim() || copy.unknownSender
      const subject = message.subject?.trim() || copy.noSubject
      return `${sender}：${subject}`
    })
    .join('\n')

  return {
    title: copy.countTitle,
    body: body || copy.title,
    group: `onemail-account-${notification.accountId}`,
    sound,
    messageId: firstMessage?.messageId
  }
}

export async function showNewMailSystemNotification(
  notification: NewMailNotification,
  copy: NewMailNotificationCopy,
  platform: NotificationPlatform,
  providerKey?: string
): Promise<boolean> {
  await sendNativeNotification({ ...buildNewMailNotificationOptions(notification, copy, platform), providerKey })
  return true
}

export async function showSyncCompleteSystemNotification(
  title: string,
  body: string
): Promise<boolean> {
  await sendNativeNotification({ title, body })
  return true
}

async function sendNativeNotification(options: NativeNotificationOptions): Promise<void> {
  await invoke('system_send_notification', {
    title: options.title,
    body: options.body ?? '',
    sound: options.sound ?? null,
    messageId: options.messageId ?? null,
    providerKey: options.providerKey ?? null
  })
}

export function onSystemNotificationOpen(callback: (messageId: number) => void): () => void {
  let active = true
  let unlisten: UnlistenFn | undefined
  void listen<number>('notifications/openMessage', (event) => {
    if (active) callback(event.payload)
  }).then((stop) => {
    if (active) unlisten = stop
    else stop()
    return invoke<number | null>('system_take_notification_message')
  }).then((messageId) => {
    if (active && messageId) callback(messageId)
  }).catch((error) => console.warn('Failed to listen for notification clicks.', error))
  return () => { active = false; unlisten?.() }
}

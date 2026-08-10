import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
  type Options
} from '@tauri-apps/plugin-notification'

import type { NewMailNotification } from '@renderer/shared/types'

type NotificationPlatform = 'macos' | 'windows' | 'linux'

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
): Options {
  const firstMessage = notification.messages[0]
  const sound =
    platform === 'macos' ? 'Ping' : platform === 'linux' ? 'message-new-instant' : undefined

  if (notification.messageCount === 1 && firstMessage) {
    return {
      title: firstMessage.fromName?.trim() || firstMessage.fromEmail?.trim() || copy.unknownSender,
      body: firstMessage.subject?.trim() || copy.noSubject,
      group: `onemail-account-${notification.accountId}`,
      sound
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
    sound
  }
}

export async function showNewMailSystemNotification(
  notification: NewMailNotification,
  copy: NewMailNotificationCopy,
  platform: NotificationPlatform
): Promise<boolean> {
  let permissionGranted = await isPermissionGranted()
  if (!permissionGranted) {
    permissionGranted = (await requestPermission()) === 'granted'
  }
  if (!permissionGranted) return false

  sendNotification(buildNewMailNotificationOptions(notification, copy, platform))
  return true
}

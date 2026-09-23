import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export function onSystemNotificationOpen(callback: (messageId: number) => void): () => void {
  type NotificationClick = { clickId: number; messageId: number }
  let active = true
  let lastClickId = 0
  let unlisten: UnlistenFn | undefined
  const deliver = (click: NotificationClick | null): void => {
    if (!active || !click || click.clickId <= lastClickId) return
    lastClickId = click.clickId
    callback(click.messageId)
  }
  const takePending = (): Promise<NotificationClick | null> =>
    invoke<NotificationClick | null>('system_take_notification_message')
  void listen<NotificationClick>('notifications/openMessage', (event) => {
    deliver(event.payload)
    void takePending().then(deliver).catch((error) =>
      console.warn('Failed to acknowledge a notification click.', error)
    )
  }).then((stop) => {
    if (!active) {
      stop()
      return null
    }
    unlisten = stop
    return takePending()
  }).then(deliver).catch((error) => console.warn('Failed to listen for notification clicks.', error))
  return () => { active = false; unlisten?.() }
}

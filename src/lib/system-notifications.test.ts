import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { expect, it, vi } from 'vitest'

import { onSystemNotificationOpen } from './system-notifications'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }))

it('delivers a clicked message once when the event and pending read overlap', async () => {
  const click = { clickId: 1, messageId: 42 }
  let receive: ((event: { payload: typeof click }) => void) | undefined
  vi.mocked(listen).mockImplementationOnce((_name, callback) => {
    receive = callback as typeof receive
    return Promise.resolve(() => {})
  })
  vi.mocked(invoke).mockResolvedValue(click)
  const onOpen = vi.fn()
  const stop = onSystemNotificationOpen(onOpen)
  await vi.waitFor(() => expect(receive).toBeDefined())
  receive?.({ payload: click })
  expect(onOpen).toHaveBeenCalledWith(42)
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('system_take_notification_message'))
  expect(onOpen).toHaveBeenCalledTimes(1)
  stop()
})

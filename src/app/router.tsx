import { createHashRouter, Navigate } from 'react-router'

import { AddAccountPage } from '@renderer/pages/accounts/new'
import { MailboxPage } from '@renderer/pages/mailbox'
import { SettingsWindow } from '@renderer/components/settings/settings-window'
import { OriginalMessageWindow } from '@renderer/components/conversations/conversation-workspace/original-message-window'

export const appRouter = createHashRouter([
  {
    path: '/',
    element: <MailboxPage />
  },
  {
    path: '/accounts/new',
    element: <AddAccountPage />
  },
  {
    path: '/settings',
    element: <SettingsWindow />
  },
  {
    path: '/original-message',
    element: <OriginalMessageWindow />
  },
  {
    path: '*',
    element: <Navigate to="/" replace />
  }
])

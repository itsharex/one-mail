import * as React from 'react'
import { MailboxWorkspaceView } from './mailbox-workspace-view'
import { useMailboxWorkspaceController } from './use-mailbox-workspace-controller'

export type { DialogKind } from './use-mailbox-workspace-controller'

export function MailboxWorkspace(): React.JSX.Element {
  const model = useMailboxWorkspaceController()
  return <MailboxWorkspaceView model={model} />
}

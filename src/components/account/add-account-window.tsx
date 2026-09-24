import * as React from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { toast } from 'sonner'

import { AddAccountForm } from '@renderer/components/account/add-account-dialog'
import { createAccount } from '@renderer/pages/accounts/new/api'
import { useI18n } from '@renderer/lib/i18n'
import type { AccountCreateInput } from '@renderer/shared/types'

export function AddAccountWindow(): React.JSX.Element {
  const { t } = useI18n()

  React.useEffect(() => {
    void getCurrentWindow().setTitle(t('account.add.title'))
  }, [t])

  async function handleSubmit(input: AccountCreateInput): Promise<void> {
    const account = await createAccount(input)
    toast.success(t('account.add.windowSaved', { email: account.email }))
    window.setTimeout(() => {
      void window.api.accounts.closeAddWindow()
    }, 450)
  }

  return (
    <main className="flex h-screen min-h-screen flex-col overflow-hidden bg-background text-foreground">
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pt-4 pb-3">
        <AddAccountForm
          onSubmit={handleSubmit}
          className="flex min-h-0 flex-1 flex-col"
          bodyClassName="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1 pb-3"
          footerClassName="flex shrink-0 justify-end border-t pt-3"
        />
      </section>
    </main>
  )
}

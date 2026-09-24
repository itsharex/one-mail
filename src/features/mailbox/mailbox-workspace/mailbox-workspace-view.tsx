import * as React from 'react'
import { invoke } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import { ConversationWorkspace } from '@renderer/components/conversations/conversation-workspace'
import { AccountList } from '@renderer/components/account/account-list'
import { AccountWarningDialog } from '@renderer/components/account/account-warning-dialog'
import { EditAccountDialog } from '@renderer/components/account/edit-account-dialog'
import { RemoveAccountDialog } from '@renderer/components/account/remove-account-dialog'
import { MailComposer } from '@renderer/components/mail/mail-composer'
import { OutboxPanel } from '@renderer/components/mail/outbox-panel'
import { BackupImportDialog } from '@renderer/components/backup/backup-import-dialog'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@renderer/components/ui/resizable'
import { installAppUpdate, openExternalUrl } from '@renderer/pages/mailbox/api'
import { ONEMAIL_HOMEPAGE_URL, hasAvailableUpdate } from '@renderer/lib/update-status'
import { NoAccountsBody, StatusBar, TitleBar } from '../mailbox-chrome'
import { useMailboxWorkspaceController } from './use-mailbox-workspace-controller'

export function MailboxWorkspaceView({ model }: { model: ReturnType<typeof useMailboxWorkspaceController> }): React.JSX.Element {
  const {
    loading,
    loadingPhase,
    showNoAccounts,
    systemInfo,
    handleOpenAddAccountWindow,
    setDialogKind,
    backupImportBusy,
    handleImportBackup,
    conversationLayout,
    accounts,
    selectedAccountId,
    openMessageId,
    setOpenMessageId,
    syncingAccountIds,
    handleSelectAccount,
    handleRefreshAccount,
    setDialogAccountId,
    setWarningAccountId,
    realAccounts,
    settings,
    refreshAccounts,
    selectedAccount,
    aiSessionEpoch,
    openComposer,
    setOutboxOpen,
    syncNotice,
    error,
    updateStatus,
    dialogAccount,
    dialogKind,
    handleUpdateAccount,
    handleReauthorizeAccount,
    handleRemoveAccount,
    warningAccount,
    warningAccountId,
    aiSettings,
    composerOpen,
    handleAiChat,
    backupImportDialogOpen,
    backupImportSource,
    setBackupImportDialogOpen,
    setBackupImportBusy,
    handleBackupImported,
    composerDraft,
    composerPending,
    closeComposer,
    sendComposerDraft,
    handleSaveComposerDraft,
    handleDiscardComposerDraft,
    outboxOpen,
    outboxPending,
    outboxMessages,
    handleRefreshOutbox,
    openOutboxDraft,
    handleRetryOutbox,
    handleDeleteOutbox,
  } = model
  const openSettings = (section: 'general' | 'about' = 'general'): void => {
    void invoke('settings_open_window', { section }).catch((reason) => toast.error(String(reason)))
  }
  return (
    <main data-workspace="conversations" className="native-window flex h-screen min-h-screen flex-col overflow-hidden text-foreground">
      {showNoAccounts ? (
        <>
          <div className="relative shrink-0">
            <TitleBar
              platform={systemInfo?.platform}
              onOpenSettings={() => openSettings()}
            />
          </div>
          <NoAccountsBody
            importingSql={backupImportBusy}
            actionsDisabled={backupImportBusy}
            onAddAccount={handleOpenAddAccountWindow}
            onImportBackup={handleImportBackup}
          />
        </>
      ) : (
        <ResizablePanelGroup
          id="onemail-conversation-layout-v1"
          orientation="horizontal"
          defaultLayout={conversationLayout.defaultLayout}
          onLayoutChanged={conversationLayout.onLayoutChanged}
          className="min-h-0 flex-1 overflow-hidden"
        >
          <ResizablePanel
            id="accounts"
            defaultSize="260px"
            minSize="220px"
            groupResizeBehavior="preserve-pixel-size"
          >
            <div className="workspace-sidebar flex h-full min-h-0 flex-col">
              <TitleBar
                platform={systemInfo?.platform}
                onOpenSettings={() => openSettings()}
              />
              <AccountList
                accounts={accounts}
                selectedAccountId={selectedAccountId}
                syncingAccountIds={syncingAccountIds}
                onSelectAccount={handleSelectAccount}
                onRefreshAccount={(account) => {
                  void handleRefreshAccount(account)
                }}
                onEditAccount={(account) => {
                  setDialogAccountId(account.id)
                  setDialogKind('edit')
                }}
                onDeleteAccount={(account) => {
                  setDialogAccountId(account.id)
                  setDialogKind('delete')
                }}
                onResolveAccountWarning={(account) => {
                  setWarningAccountId(account.id)
                }}
              />
            </div>
          </ResizablePanel>

          <ResizableHandle />

          <ResizablePanel id="conversations" data-workspace-content minSize="600px">
            <div className="flex h-full min-h-0 flex-col overflow-hidden">
              <ConversationWorkspace
                accounts={realAccounts}
                settings={settings}
                accountId={selectedAccount.accountId}
                databasePath={systemInfo?.databasePath}
                onSelectAccount={handleSelectAccount}
                onAddAccount={handleOpenAddAccountWindow}
                openMessageId={openMessageId}
                onOpenMessageHandled={() => setOpenMessageId(null)}
                refreshKey={aiSessionEpoch}
                onCompose={() => { void openComposer('new') }}
                onOpenOutbox={() => setOutboxOpen(true)}
                aiSettings={aiSettings?.verified ? aiSettings : undefined}
                onAiChat={aiSettings?.verified ? handleAiChat : undefined}
              />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      )}

      <StatusBar
        loading={loading}
        loadingPhase={loadingPhase}
        accounts={realAccounts}
        systemInfo={systemInfo}
        settings={settings}
        accountCount={realAccounts.length}
        messageCount={selectedAccount.messageCount ?? 0}
        syncNotice={syncNotice}
        error={error}
        updateStatus={updateStatus}
        onOpenAccountWarning={(accountId) => {
          void refreshAccounts().catch(() => undefined).then(() => setWarningAccountId(accountId))
        }}
        onOpenVersion={() => {
          if (hasAvailableUpdate(updateStatus)) {
            void openExternalUrl(ONEMAIL_HOMEPAGE_URL)
            return
          }
          openSettings('about')
        }}
        onInstallUpdate={() => { void installAppUpdate() }}
      />

      <EditAccountDialog
        account={dialogAccount ?? selectedAccount}
        open={dialogKind === 'edit'}
        onOpenChange={(open) => {
          setDialogKind(open ? 'edit' : null)
          if (!open) setDialogAccountId(null)
        }}
        onSubmit={handleUpdateAccount}
        onReauthorize={handleReauthorizeAccount}
      />
      <RemoveAccountDialog
        account={dialogAccount ?? selectedAccount}
        open={dialogKind === 'delete'}
        onOpenChange={(open) => {
          setDialogKind(open ? 'delete' : null)
          if (!open) setDialogAccountId(null)
        }}
        onConfirm={handleRemoveAccount}
      />
      {warningAccount ? (
        <AccountWarningDialog
          account={warningAccount}
          open={Boolean(warningAccountId)}
          syncing={syncingAccountIds.has(warningAccount.id)}
          onOpenChange={(open) => {
            if (!open) setWarningAccountId(null)
          }}
          onEdit={(account) => {
            setDialogAccountId(account.id)
            setDialogKind('edit')
          }}
          onRetry={(account) => {
            void handleRefreshAccount(account)
          }}
          onDelete={(account) => {
            setDialogAccountId(account.id)
            setDialogKind('delete')
          }}
          onReauthorize={handleReauthorizeAccount}
        />
      ) : null}
      <BackupImportDialog
        open={backupImportDialogOpen}
        defaultSource={backupImportSource}
        onOpenChange={setBackupImportDialogOpen}
        onBusyChange={setBackupImportBusy}
        onImported={handleBackupImported}
      />
      <MailComposer
        open={composerOpen}
        accounts={realAccounts}
        draft={composerDraft}
        pending={composerPending}
        onOpenChange={(open) => {
          if (!open) closeComposer()
        }}
        onSend={sendComposerDraft}
        onSaveDraft={handleSaveComposerDraft}
        onDiscardDraft={handleDiscardComposerDraft}
      />
      <OutboxPanel
        open={outboxOpen}
        pending={outboxPending}
        outboxMessages={outboxMessages}
        onOpenChange={setOutboxOpen}
        onRefresh={handleRefreshOutbox}
        onOpenDraft={(message) => {
          setOutboxOpen(false)
          openOutboxDraft(message)
        }}
        onRetry={(message) => {
          void handleRetryOutbox(message)
        }}
        onDelete={(message) => {
          void handleDeleteOutbox(message)
        }}
      />
    </main>
  )
}

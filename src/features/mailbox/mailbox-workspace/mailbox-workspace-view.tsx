import * as React from 'react'
import { ConversationWorkspace } from '@renderer/components/conversations/conversation-workspace'
import { AccountList } from '@renderer/components/account/account-list'
import { AiAssistant } from '@renderer/components/ai/ai-assistant'
import { AccountWarningDialog } from '@renderer/components/account/account-warning-dialog'
import { EditAccountDialog } from '@renderer/components/account/edit-account-dialog'
import { OutlookImapHelpDialog } from '@renderer/components/account/outlook-imap-help-dialog'
import { RemoveAccountDialog } from '@renderer/components/account/remove-account-dialog'
import { MailComposer } from '@renderer/components/mail/mail-composer'
import { OutboxPanel } from '@renderer/components/mail/outbox-panel'
import { BackupImportDialog } from '@renderer/components/backup/backup-import-dialog'
import { SettingsDialog } from '@renderer/components/settings/settings-dialog'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@renderer/components/ui/resizable'
import { installAppUpdate, openExternalUrl } from '@renderer/pages/mailbox/api'
import { ONEMAIL_HOMEPAGE_URL, hasAvailableUpdate } from '@renderer/lib/update-status'
import { NoAccountsBody, StatusBar, TitleBar } from '../mailbox-chrome'
import { useMailboxWorkspaceController } from './use-mailbox-workspace-controller'

export function MailboxWorkspaceView({ model }: { model: ReturnType<typeof useMailboxWorkspaceController> }): React.JSX.Element {
  const {
    showNoAccounts,
    systemInfo,
    handleOpenAddAccountWindow,
    setSettingsInitialSection,
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
    selectedAccount,
    aiSessionEpoch,
    openComposer,
    setOutboxOpen,
    syncNotice,
    error,
    syncFailures,
    setError,
    setSyncFailures,
    updateStatus,
    dialogAccount,
    dialogKind,
    handleUpdateAccount,
    handleReauthorizeAccount,
    handleRemoveAccount,
    warningAccount,
    warningAccountId,
    aiSettings,
    settingsInitialSection,
    handleUpdateSettings,
    handleVerifyAiSettings,
    handleClearAiSettings,
    reloadAfterBackupImport,
    composerOpen,
    handleAiChat,
    backupImportDialogOpen,
    backupImportSource,
    setBackupImportDialogOpen,
    setBackupImportBusy,
    handleBackupImported,
    outlookImapHelpAccount,
    setOutlookImapHelpAccount,
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
  return (
    <main data-workspace="conversations" className="native-window flex h-screen min-h-screen flex-col overflow-hidden text-foreground">
      {showNoAccounts ? (
        <>
          <div className="relative shrink-0">
            <TitleBar
              platform={systemInfo?.platform}
              onAddAccount={handleOpenAddAccountWindow}
              onOpenSettings={() => {
                setSettingsInitialSection('general')
                setDialogKind('settings')
              }}
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
                onAddAccount={handleOpenAddAccountWindow}
                onOpenSettings={() => {
                  setSettingsInitialSection('general')
                  setDialogKind('settings')
                }}
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
                openMessageId={openMessageId}
                onOpenMessageHandled={() => setOpenMessageId(null)}
                refreshKey={aiSessionEpoch}
                onCompose={() => { void openComposer('new') }}
                onOpenOutbox={() => setOutboxOpen(true)}
              />
              <StatusBar
                systemInfo={systemInfo}
                settings={settings}
                accountCount={realAccounts.length}
                messageCount={selectedAccount.messageCount ?? 0}
                syncNotice={syncNotice}
                error={error}
                syncErrors={syncFailures.map((failure) => {
                  const account = accounts.find((item) => item.accountId === failure.accountId)
                  return `${account?.address || account?.name || `#${failure.accountId}`}：${failure.error}`
                })}
                onDismissError={() => { setError(null); setSyncFailures([]) }}
                updateStatus={updateStatus}
                onOpenVersion={() => {
                  if (hasAvailableUpdate(updateStatus)) {
                    void openExternalUrl(ONEMAIL_HOMEPAGE_URL)
                    return
                  }
                  setSettingsInitialSection('about')
                  setDialogKind('settings')
                }}
                onInstallUpdate={() => { void installAppUpdate() }}
              />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      )}

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
      <SettingsDialog
        open={dialogKind === 'settings'}
        settings={settings}
        systemInfo={systemInfo}
        updateStatus={updateStatus}
        aiSettings={aiSettings}
        initialSection={settingsInitialSection}
        onOpenChange={(open) => setDialogKind(open ? 'settings' : null)}
        onSubmit={handleUpdateSettings}
        onVerifyAi={handleVerifyAiSettings}
        onClearAi={handleClearAiSettings}
        onImported={reloadAfterBackupImport}
      />
      {aiSettings?.verified ? (
        <AiAssistant
          key={aiSessionEpoch}
          settings={aiSettings}
          launcherHidden={composerOpen}
          onChat={handleAiChat}
        />
      ) : null}
      <BackupImportDialog
        open={backupImportDialogOpen}
        defaultSource={backupImportSource}
        onOpenChange={setBackupImportDialogOpen}
        onBusyChange={setBackupImportBusy}
        onImported={handleBackupImported}
      />
      <OutlookImapHelpDialog
        accountLabel={outlookImapHelpAccount?.name}
        open={Boolean(outlookImapHelpAccount)}
        onOpenChange={(open) => {
          if (!open) setOutlookImapHelpAccount(null)
        }}
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

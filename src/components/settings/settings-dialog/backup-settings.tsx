import {
  ChevronRight,
  Cloud,
  Download,
  FileUp,
  FolderOpen,
  KeyRound,
  RefreshCcw,
  Server,
  ShieldCheck,
  Upload,
} from 'lucide-react'
import * as React from 'react'
import { openExternalUrl, revealPathInFileManager } from '@renderer/pages/mailbox/api'
import { BackupSyncConfigDialog } from '@renderer/components/backup/backup-sync-config-dialog'
import { SweepShine } from '@renderer/components/sweep-shine'
import { Button } from '@renderer/components/ui/button'
import { FieldError } from '@renderer/components/ui/field'
import { Alert, AlertTitle } from '@renderer/components/ui/alert'
import type{ BackupImportResult, BackupSyncSettings } from '@renderer/shared/types'
import { useI18n, type TranslationKey } from '@renderer/lib/i18n'
import type { BackupPending, BackupMessage } from './settings-types'
import { SettingsGroup, SettingsHelp, SETTINGS_LIST_CLASS } from './settings-ui'

export function BackupSettings({
  pending,
  message,
  error,
  syncSettings,
  onExport,
  onImport,
  onSaveSync,
  onTestSync,
  onUploadSync,
  onDownloadSync
}: {
  pending: BackupPending
  message: BackupMessage | null
  error: string | null
  syncSettings: BackupSyncSettings | null
  onExport: () => Promise<void>
  onImport: () => void
  onSaveSync: (input: BackupSyncSettings) => Promise<boolean>
  onTestSync: (input: BackupSyncSettings) => Promise<boolean>
  onUploadSync: () => Promise<void>
  onDownloadSync: (input: BackupSyncSettings) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const [configOpen, setConfigOpen] = React.useState(false)
  const disabled = Boolean(pending)
  const remoteSettings =
    syncSettings && syncSettings.provider !== 'none' ? syncSettings : null
  const RemoteIcon = remoteSettings?.provider === 'webdav' ? Server : Cloud

  return (
    <>
      <div className="flex w-full flex-col gap-3">
        <SettingsGroup title={t('settings.backup.localGroup')}>
          <div className={SETTINGS_LIST_CLASS}>
            <BackupActionButton
              icon={Download}
              title={t('settings.backup.export')}
              loadingTitle={t('settings.backup.exporting')}
              description={t('settings.backup.exportDescription')}
              loading={pending === 'export'}
              disabled={disabled}
              onClick={onExport}
            />
            <BackupActionButton
              icon={FileUp}
              title={t('settings.backup.import')}
              loadingTitle={t('settings.backup.importing')}
              description={t('settings.backup.importDescription')}
              loading={pending === 'import'}
              disabled={disabled}
              onClick={onImport}
            />
          </div>
        </SettingsGroup>

        <SettingsGroup title={t('settings.backup.remoteGroup')}>
          <div className={SETTINGS_LIST_CLASS}>
            {remoteSettings ? (
              <Button
                type="button"
                variant="ghost"
                className="h-10 w-full min-w-0 justify-start gap-2.5 rounded-none px-3 py-1.5 text-left hover:bg-muted/45"
                disabled={disabled}
                onClick={() => setConfigOpen(true)}
              >
                <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/70 text-muted-foreground">
                  <RemoteIcon className="size-3.5" aria-hidden="true" />
                </div>
                <div className="flex min-w-0 flex-1 items-center gap-2"><span className="text-xs font-medium">{remoteSettings.provider === 'webdav' ? 'WebDAV' : 'S3'}</span><span className="truncate text-xs text-muted-foreground">{formatRemoteSettingsSummary(remoteSettings)}</span></div>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {t('settings.backup.remoteEdit')}
                </span>
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                className="h-10 w-full justify-start gap-2.5 rounded-none px-3 py-1.5 text-left hover:bg-muted/45"
                disabled={disabled}
                onClick={() => setConfigOpen(true)}
              >
                <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/70 text-muted-foreground">
                  <Cloud className="size-3.5" aria-hidden="true" />
                </div>
                <div className="flex min-w-0 flex-1 items-center gap-1.5"><span className="text-xs font-medium">{t('settings.backup.remoteEmptyTitle')}</span><SettingsHelp description={t('settings.backup.remoteEmptyDescription')} focusable={false} /></div>
                <span className="shrink-0 text-[11px] text-primary">
                  {t('settings.backup.remoteAdd')}
                </span>
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
              </Button>
            )}

            {remoteSettings ? (
              <>
                <BackupActionButton
                  icon={RefreshCcw}
                  title={t('settings.backup.remoteTest')}
                  loadingTitle={t('settings.backup.remoteTesting')}
                  loading={pending === 'testRemote'}
                  disabled={disabled}
                  onClick={async () => {
                    await onTestSync(remoteSettings)
                  }}
                />
                <BackupActionButton
                  icon={Upload}
                  title={t('settings.backup.remoteUpload')}
                  loadingTitle={t('settings.backup.remoteUploading')}
                  loading={pending === 'uploadRemote'}
                  disabled={disabled}
                  onClick={onUploadSync}
                />
                <BackupActionButton
                  icon={Download}
                  title={t('settings.backup.remoteDownload')}
                  loadingTitle={t('settings.backup.remoteDownloading')}
                  loading={pending === 'downloadRemote'}
                  disabled={disabled}
                  onClick={() => onDownloadSync(remoteSettings)}
                />
              </>
            ) : null}
          </div>
        </SettingsGroup>

        <SettingsGroup title={t('settings.backup.securityGroup')}>
          <div className={`${SETTINGS_LIST_CLASS} flex min-h-10 items-center gap-2.5 px-3 py-1.5`}>
            <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/70 text-muted-foreground">
              <KeyRound className="size-3.5" aria-hidden="true" />
            </div>
            <div className="flex min-w-0 items-center gap-1.5"><span className="text-xs font-medium">{t('settings.backup.securityTitle')}</span><SettingsHelp description={t('settings.backup.securityDescription')} /></div>
          </div>
        </SettingsGroup>

        {message ? <BackupMessageView message={message} /> : null}
        {error && !configOpen ? <FieldError>{error}</FieldError> : null}
      </div>

      <BackupSyncConfigDialog
        open={configOpen}
        currentSettings={syncSettings}
        saving={pending === 'saveRemote'}
        testing={pending === 'testRemote'}
        error={error}
        onOpenChange={setConfigOpen}
        onSave={onSaveSync}
        onTest={onTestSync}
      />
    </>
  )
}

function formatRemoteSettingsSummary(settings: BackupSyncSettings): string {
  if (settings.provider === 'webdav') return settings.remoteUrl
  if (settings.provider === 's3') {
    const endpoint = settings.endpoint ? `${settings.endpoint.replace(/\/$/, '')} · ` : ''
    return `${endpoint}${settings.bucket}/${settings.key}`
  }
  return ''
}

export function formatImportResultMessage(
  result: BackupImportResult,
  remote: boolean,
  t: (key: TranslationKey, values?: Record<string, string | number>) => string
): string {
  const values = {
    accounts: result.accountCount ?? 0,
    messages: result.messageCount ?? 0
  }

  return t(
    remote ? 'settings.backup.remoteDownloadedSummary' : 'settings.backup.importedSummary',
    values
  )
}

export function getBackupActionErrorMessage(error: unknown, t: (key: TranslationKey) => string): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
          ? error.message
          : t('settings.backup.error')
  return message.replace(/^Error invoking remote method '[^']+':\s*/i, '')
}

function BackupMessageView({ message }: { message: BackupMessage }): React.JSX.Element {
  const isRemotePath =
    message.path?.startsWith('http://') === true || message.path?.startsWith('https://') === true

  if (!message.path) {
    return (
      <Alert className="py-2 text-xs">
        <ShieldCheck />
        <AlertTitle>{message.label}</AlertTitle>
      </Alert>
    )
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-md border bg-card p-2.5 text-xs">
      <div className="flex items-center gap-1.5 font-medium">
        <ShieldCheck aria-hidden="true" />
        <span>{message.label}</span>
      </div>
      <Button
        className="h-auto justify-start break-all px-0 py-0 text-left whitespace-normal"
        variant="link"
        size="sm"
        onClick={() =>
          void (isRemotePath
            ? openExternalUrl(message.path!)
            : revealPathInFileManager(message.path!))
        }
      >
        <FolderOpen data-icon="inline-start" />
        {message.path}
      </Button>
    </div>
  )
}

function BackupActionButton({
  icon: Icon,
  title,
  loadingTitle,
  description,
  loading,
  disabled,
  onClick
}: {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
  title: string
  loadingTitle: string
  description?: string
  loading: boolean
  disabled: boolean
  onClick: () => void | Promise<void>
}): React.JSX.Element {
  return (
    <Button
      type="button"
      variant="ghost"
      className="h-10 w-full min-w-0 justify-start gap-2.5 rounded-none border-t border-border/40 px-3 py-1.5 text-left first:border-t-0 hover:bg-muted/45"
      onClick={onClick}
      disabled={disabled}
    >
      <span
        className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/70 text-muted-foreground"
      >
        <Icon className="size-3.5" aria-hidden="true" />
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="truncate">
          {loading ? <SweepShine>{loadingTitle}</SweepShine> : title}
        </span>
        {description ? <SettingsHelp description={description} focusable={false} /> : null}
      </span>
      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
    </Button>
  )
}

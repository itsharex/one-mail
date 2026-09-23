import { zodResolver } from '@hookform/resolvers/zod'
import { BadgeInfo, Bot, DatabaseBackup, RefreshCcw } from 'lucide-react'
import * as React from 'react'
import { useForm, useWatch } from 'react-hook-form'
import {
  exportSqlBackup,
  loadBackupSyncSettings,
  saveBackupSyncSettings,
  testBackupSyncSettings,
  uploadBackupSync,
} from '@renderer/pages/mailbox/api'
import {
  BackupImportDialog,
  type BackupImportDialogSource,
} from '@renderer/components/backup/backup-import-dialog'
import { getBackupSyncSettingsKey } from '@renderer/components/backup/backup-sync-draft'
import { ResponsiveDialog } from '@renderer/components/responsive-dialog'
import type{ AppSettings, AppUpdateStatus, AiSettings, AiSettingsInput, BackupImportResult, BackupImportSource, BackupSyncDownloadResult, BackupSyncSettings, SettingsUpdateInput, SystemInfo } from '@renderer/shared/types'
import { useI18n, type TranslationKey } from '@renderer/lib/i18n'
import { AiSettingsForm } from './ai-settings'
import { GeneralSettingsForm } from './general-settings'
import { BackupSettings, formatImportResultMessage, getBackupActionErrorMessage } from './backup-settings'
import { AboutSettings } from './about-settings'
import { createSettingsSchema, toFormValues, areSettingsEqual, type SettingsFormValues } from './settings-form'
import type { BackupPending, BackupMessage } from './settings-types'

type SettingsDialogProps = {
  open: boolean
  settings: AppSettings | null
  systemInfo: SystemInfo | null
  updateStatus: AppUpdateStatus | null
  aiSettings: AiSettings | null
  initialSection?: SettingsSection
  onOpenChange: (open: boolean) => void
  onSubmit: (input: SettingsUpdateInput) => Promise<void>
  onVerifyAi: (input: AiSettingsInput) => Promise<AiSettings>
  onClearAi: () => Promise<AiSettings>
  onImported?: () => Promise<void> | void
}

type SettingsSection = 'general' | 'ai' | 'backup' | 'about'
const AUTO_SAVE_DELAY_MS = 350

const sections: Array<{
  value: SettingsSection
  labelKey: TranslationKey
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
}> = [
  {
    value: 'general',
    labelKey: 'settings.general',
    icon: RefreshCcw
  },
  {
    value: 'ai',
    labelKey: 'settings.ai',
    icon: Bot
  },
  {
    value: 'backup',
    labelKey: 'settings.backup',
    icon: DatabaseBackup
  },
  {
    value: 'about',
    labelKey: 'settings.about',
    icon: BadgeInfo
  }
]

export function SettingsDialog({
  open,
  settings,
  systemInfo,
  updateStatus,
  aiSettings,
  initialSection = 'general',
  onOpenChange,
  onSubmit,
  onVerifyAi,
  onClearAi,
  onImported
}: SettingsDialogProps): React.JSX.Element {
  const { t } = useI18n()
  const settingsSchema = React.useMemo(() => createSettingsSchema(t), [t])
  const [section, setSection] = React.useState<SettingsSection>('general')
  const [pending, setPending] = React.useState(false)
  const [backupPending, setBackupPending] = React.useState<BackupPending>(null)
  const [backupImportDialogOpen, setBackupImportDialogOpen] = React.useState(false)
  const [backupImportDefaultSource, setBackupImportDefaultSource] =
    React.useState<BackupImportDialogSource>('sql')
  const [backupImportSyncSettings, setBackupImportSyncSettings] =
    React.useState<BackupSyncSettings | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [backupMessage, setBackupMessage] = React.useState<BackupMessage | null>(null)
  const [backupError, setBackupError] = React.useState<string | null>(null)
  const [backupSyncSettings, setBackupSyncSettings] = React.useState<BackupSyncSettings | null>(
    null
  )
  const lastSavedValuesRef = React.useRef<SettingsFormValues>(toFormValues(settings))
  const autoSaveTimerRef = React.useRef<number | null>(null)
  const queuedValuesRef = React.useRef<SettingsFormValues | null>(null)
  const savingRef = React.useRef(false)
  const wasOpenRef = React.useRef(false)
  const backupImportSourceRef = React.useRef<BackupImportDialogSource>('sql')
  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: toFormValues(settings),
    mode: 'onChange'
  })
  const watchedValues = useWatch({ control: form.control })

  const saveSettingsValues = React.useCallback(
    async (values: SettingsFormValues): Promise<void> => {
      if (areSettingsEqual(values, lastSavedValuesRef.current)) return
      if (savingRef.current) {
        queuedValuesRef.current = values
        return
      }

      savingRef.current = true
      setPending(true)
      setError(null)

      let nextValues: SettingsFormValues | null = values
      while (nextValues) {
        const currentValues = nextValues
        queuedValuesRef.current = null

        try {
          await onSubmit({
            syncIntervalMinutes: currentValues.syncIntervalMinutes,
            syncWindowDays: currentValues.syncWindowDays,
            openAtLogin: currentValues.openAtLogin,
            externalImagesBlocked: currentValues.externalImagesBlocked,
            bodyDisplayMode: currentValues.bodyDisplayMode,
            locale: currentValues.locale
          })
          lastSavedValuesRef.current = currentValues
        } catch (submitError) {
          setError(submitError instanceof Error ? submitError.message : t('settings.updateError'))
          break
        }

        nextValues = queuedValuesRef.current
        if (nextValues && areSettingsEqual(nextValues, lastSavedValuesRef.current)) {
          nextValues = null
        }
      }

      savingRef.current = false
      queuedValuesRef.current = null
      setPending(false)
    },
    [onSubmit, t]
  )

  const flushPendingSettings = React.useCallback((): void => {
    if (autoSaveTimerRef.current) {
      window.clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = null
    }

    const parsedValues = settingsSchema.safeParse(form.getValues())
    if (parsedValues.success) {
      void saveSettingsValues(parsedValues.data)
    }
  }, [form, saveSettingsValues, settingsSchema])

  React.useEffect(() => {
    if (!open) {
      wasOpenRef.current = false
      return
    }
    if (wasOpenRef.current) return

    const nextValues = toFormValues(settings)
    lastSavedValuesRef.current = nextValues
    form.reset(nextValues)
    setSection(initialSection)
    wasOpenRef.current = true
  }, [form, initialSection, open, settings])

  React.useEffect(() => {
    if (!open || section !== 'backup') return
    if (!('__TAURI_INTERNALS__' in window)) return

    let cancelled = false
    void loadBackupSyncSettings()
      .then((nextSettings) => {
        if (!cancelled) setBackupSyncSettings(nextSettings)
      })
      .catch((loadError) => {
        if (!cancelled) {
          setBackupError(
            loadError instanceof Error ? loadError.message : t('settings.backup.error')
          )
        }
      })

    return () => {
      cancelled = true
    }
  }, [open, section, t])

  React.useEffect(() => {
    if (!open) return

    if (autoSaveTimerRef.current) {
      window.clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = null
    }

    const parsedValues = settingsSchema.safeParse(watchedValues)
    if (!parsedValues.success) return
    if (areSettingsEqual(parsedValues.data, lastSavedValuesRef.current)) return

    autoSaveTimerRef.current = window.setTimeout(() => {
      autoSaveTimerRef.current = null
      void saveSettingsValues(parsedValues.data)
    }, AUTO_SAVE_DELAY_MS)

    return () => {
      if (autoSaveTimerRef.current) {
        window.clearTimeout(autoSaveTimerRef.current)
        autoSaveTimerRef.current = null
      }
    }
  }, [open, saveSettingsValues, settingsSchema, watchedValues])

  React.useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        window.clearTimeout(autoSaveTimerRef.current)
        autoSaveTimerRef.current = null
      }
    }
  }, [])

  function handleOpenChange(nextOpen: boolean): void {
    if ((pending || backupPending) && !nextOpen) return

    if (!nextOpen) {
      flushPendingSettings()
      setError(null)
      setBackupError(null)
      setBackupMessage(null)
      setSection('general')
    }
    onOpenChange(nextOpen)
  }

  async function handleExport(): Promise<void> {
    await runBackupAction('export', async () => {
      const path = await exportSqlBackup()
      setBackupMessage(
        path
          ? { label: t('settings.backup.exported'), path }
          : { label: t('settings.backup.exportCanceled') }
      )
    })
  }

  function handleImport(): void {
    openBackupImportDialog('sql')
  }

  async function handleSaveBackupSync(input: BackupSyncSettings): Promise<boolean> {
    return runBackupAction('saveRemote', async () => {
      const nextSettings = await saveBackupSyncSettings(input)
      setBackupSyncSettings(nextSettings)
      setBackupMessage({ label: t('settings.backup.remoteSaved') })
    })
  }

  async function handleTestBackupSync(input: BackupSyncSettings): Promise<boolean> {
    return runBackupAction('testRemote', async () => {
      const result = await testBackupSyncSettings(input)
      setBackupMessage({
        label: t('settings.backup.remoteTested'),
        path: result.remotePath
      })
    })
  }

  async function handleUploadBackupSync(): Promise<void> {
    await runBackupAction('uploadRemote', async () => {
      const result = await uploadBackupSync()
      setBackupMessage({
        label: t('settings.backup.remoteUploaded'),
        path: result.remotePath
      })
    })
  }

  function handleDownloadBackupSync(input: BackupSyncSettings): void {
    if (input.provider === 'none') return
    openBackupImportDialog(input.provider, input)
  }

  function openBackupImportDialog(
    source: BackupImportDialogSource,
    syncInput?: BackupSyncSettings
  ): void {
    if (backupPending) return
    backupImportSourceRef.current = source
    setBackupImportDefaultSource(source)
    setBackupImportSyncSettings(syncInput ?? null)
    setBackupError(null)
    setBackupMessage(null)
    setBackupImportDialogOpen(true)
  }

  function handleBackupImportBusyChange(busy: boolean): void {
    setBackupPending(
      busy ? (backupImportSourceRef.current === 'sql' ? 'import' : 'downloadRemote') : null
    )
  }

  async function handleBackupImported(
    result: BackupImportResult | BackupSyncDownloadResult,
    source: BackupImportSource
  ): Promise<void> {
    const remote = source !== 'local'
    setBackupMessage({
      label: formatImportResultMessage(result, remote, t),
      path: remote && 'remotePath' in result ? result.remotePath : result.filePath
    })
    await onImported?.()
  }

  async function runBackupAction(
    action: Exclude<BackupPending, null>,
    task: () => Promise<void>
  ): Promise<boolean> {
    setBackupPending(action)
    setBackupError(null)
    setBackupMessage(null)

    try {
      await task()
      return true
    } catch (backupActionError) {
      setBackupError(getBackupActionErrorMessage(backupActionError, t))
      return false
    } finally {
      setBackupPending(null)
    }
  }

  return (
    <>
      <ResponsiveDialog
        open={open}
        onOpenChange={handleOpenChange}
        title={t('settings.title')}
        contentClassName="h-[min(560px,90dvh)] grid-rows-[auto_auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-lg p-0 sm:h-[min(500px,86vh)] sm:max-w-[720px] md:grid-rows-[auto_minmax(0,1fr)]"
        headerClassName="shrink-0 border-b bg-background px-4 py-2.5 pr-12 [&_[data-slot=dialog-title]]:text-sm! [&_[data-slot=drawer-title]]:text-sm!"
        bodyClassName="h-full min-h-0 overflow-hidden"
      >
        <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden md:grid-cols-[144px_minmax(0,1fr)] md:grid-rows-1">
          <nav
            className="flex shrink-0 gap-1 border-b bg-muted/40 p-2 md:h-full md:flex-col md:border-r md:border-b-0"
            aria-label={t('settings.title')}
          >
            {sections.map((item) => {
              const Icon = item.icon
              const active = section === item.value
              return (
                <button
                  key={item.value}
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  className={`flex h-8 min-w-0 flex-1 items-center justify-center gap-2 rounded-md px-2 text-xs font-medium transition-colors md:flex-none md:justify-start ${
                    active
                      ? 'bg-background/95 text-foreground shadow-sm ring-1 ring-black/5 dark:ring-white/8'
                      : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'
                  }`}
                  onClick={() => setSection(item.value)}
                >
                  <Icon className="size-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">{t(item.labelKey)}</span>
                </button>
              )
            })}
          </nav>

          <div className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] bg-muted/25">
            <div className="flex h-10 items-center border-b bg-background/90 px-4">
              <h2 className="text-sm font-semibold">
                {t(sections.find((item) => item.value === section)?.labelKey ?? 'settings.general')}
              </h2>
            </div>
            <div className="min-h-0 overflow-auto">
              {section === 'general' ? (
                <GeneralSettingsForm form={form} error={error} />
              ) : section === 'ai' ? (
                <AiSettingsForm
                  settings={aiSettings}
                  onVerify={onVerifyAi}
                  onClear={onClearAi}
                />
              ) : section === 'backup' ? (
                <BackupSettings
                  key={getBackupSyncSettingsKey(backupSyncSettings)}
                  pending={backupPending}
                  message={backupMessage}
                  error={backupError}
                  syncSettings={backupSyncSettings}
                  onExport={handleExport}
                  onImport={handleImport}
                  onSaveSync={handleSaveBackupSync}
                  onTestSync={handleTestBackupSync}
                  onUploadSync={handleUploadBackupSync}
                  onDownloadSync={handleDownloadBackupSync}
                />
              ) : (
                <AboutSettings systemInfo={systemInfo} updateStatus={updateStatus} />
              )}
            </div>
          </div>
        </div>
      </ResponsiveDialog>

      <BackupImportDialog
        open={backupImportDialogOpen}
        defaultSource={backupImportDefaultSource}
        syncSettings={backupImportSyncSettings ?? backupSyncSettings ?? undefined}
        onOpenChange={(nextOpen) => {
          setBackupImportDialogOpen(nextOpen)
          if (!nextOpen) setBackupImportSyncSettings(null)
        }}
        onBusyChange={handleBackupImportBusyChange}
        onImported={handleBackupImported}
      />
    </>
  )
}

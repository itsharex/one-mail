import * as React from 'react'
import { listen, emit } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { SettingsDialog } from './settings-dialog'
import { loadAiSettings, saveSettings, verifyAndSaveAiSettings, clearAiSettings, getAppUpdateStatus, onAppUpdateStatus } from '@renderer/lib/api'
import { useI18n, normalizeLocale } from '@renderer/lib/i18n'
import type { AiSettings, AppSettings, AppUpdateStatus, SystemInfo } from '@renderer/shared/types'

export function SettingsWindow(): React.JSX.Element {
  const { t, setLocale } = useI18n()
  const [settings, setSettings] = React.useState<AppSettings | null>(null)
  const [aiSettings, setAiSettings] = React.useState<AiSettings | null>(null)
  const [systemInfo, setSystemInfo] = React.useState<SystemInfo | null>(null)
  const [updateStatus, setUpdateStatus] = React.useState<AppUpdateStatus | null>(null)
  const [error, setError] = React.useState('')
  const [section, setSection] = React.useState<'general' | 'about'>(
    new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('section') === 'about' ? 'about' : 'general'
  )

  React.useEffect(() => {
    void getCurrentWindow().setTitle(`${t('settings.title')} - OneMail`)
  }, [t])

  React.useEffect(() => {
    let active = true
    void Promise.all([
      window.api.settings.get(),
      loadAiSettings().catch(() => null),
      window.api.system.info(),
      getAppUpdateStatus().catch(() => null)
    ])
      .then(([nextSettings, nextAi, nextSystem, nextUpdate]) => {
        if (!active) return
        setSettings(nextSettings)
        setAiSettings(nextAi)
        setSystemInfo(nextSystem)
        setUpdateStatus(nextUpdate)
        setLocale(normalizeLocale(nextSettings.locale))
      })
      .catch((reason) => { if (active) setError(String(reason)) })
    const stopStatus = onAppUpdateStatus(setUpdateStatus)
    let stopSection: (() => void) | undefined
    void listen<'general' | 'about'>('settings/showSection', (event) => setSection(event.payload))
      .then((stop) => { if (active) stopSection = stop; else stop() })
    return () => { active = false; stopStatus(); stopSection?.() }
  }, [setLocale])

  return <main className="flex h-screen min-h-screen flex-col overflow-hidden bg-muted text-foreground">
    {error ? <p role="alert" className="p-5 text-sm text-destructive">{error}</p> : settings ? (
      <div className="min-h-0 flex-1">
        <SettingsDialog
          open
          standalone
          settings={settings}
          systemInfo={systemInfo}
          updateStatus={updateStatus}
          aiSettings={aiSettings}
          initialSection={section}
          onOpenChange={(open) => { if (!open) void getCurrentWindow().close() }}
          onSubmit={async (input) => {
            const updated = await saveSettings(input)
            setSettings(updated)
            setLocale(normalizeLocale(updated.locale))
          }}
          onVerifyAi={async (input) => {
            const updated = await verifyAndSaveAiSettings(input)
            setAiSettings(updated)
            return updated
          }}
          onClearAi={async () => {
            const updated = await clearAiSettings()
            setAiSettings(updated)
            return updated
          }}
          onImported={() => emit('settings/backupImported')}
        />
      </div>
    ) : <div className="p-5 text-sm text-muted-foreground">{t('settings.title')}…</div>}
  </main>
}

import { BadgeInfo, Bug, ExternalLink, FolderOpen, RotateCw } from 'lucide-react'
import * as React from 'react'
import { useForm } from 'react-hook-form'
import { Button } from '@renderer/components/ui/button'
import { FieldGroup } from '@renderer/components/ui/field'
import { Input } from '@renderer/components/ui/input'
import type { AppUpdateStatus, SystemInfo } from '@renderer/shared/types'
import { useI18n } from '@renderer/lib/i18n'
import { ONEMAIL_HOMEPAGE_URL, hasAvailableUpdate } from '@renderer/lib/update-status'
import type { SettingsFormValues } from './settings-form'
import { SettingsGroup, SettingRow, SETTINGS_LIST_CLASS } from './settings-ui'

export function AboutSettings({ systemInfo, updateStatus, form }: {
  systemInfo: SystemInfo | null
  updateStatus: AppUpdateStatus | null
  form: ReturnType<typeof useForm<SettingsFormValues>>
}): React.JSX.Element {
  const { t } = useI18n()
  const [versionClicks, setVersionClicks] = React.useState(0)
  const [actionError, setActionError] = React.useState('')
  const version = systemInfo?.appVersion ? `v${systemInfo.appVersion}` : t('common.loading')
  const hasUpdate = hasAvailableUpdate(updateStatus)

  async function run(action: () => Promise<boolean>): Promise<void> {
    setActionError('')
    try { await action() } catch (error) { setActionError(String(error)) }
  }

  return <div className="flex flex-col gap-3">
    <SettingsGroup title={t('settings.about.appGroup')}>
      <FieldGroup className={SETTINGS_LIST_CLASS}>
        <SettingRow
          icon={BadgeInfo}
          title="OneMail"
          description={<>
            <Button type="button" variant="link" size="sm" className="h-auto p-0 font-mono text-foreground" onClick={() => setVersionClicks((count) => Math.min(5, count + 1))} title={t('settings.about.versionPrefix')}>{version}</Button>
            {hasUpdate && <Button type="button" variant="link" size="sm" className="ml-2 h-auto p-0 text-primary" onClick={() => void window.api.system.openExternal(ONEMAIL_HOMEPAGE_URL)}>{t('settings.about.updateAvailable')}</Button>}
          </>}
          control={<Button variant="ghost" size="sm" onClick={() => void window.api.system.openExternal('https://github.com/zhihui-hu/one-mail')}><ExternalLink className="size-3.5" />GitHub</Button>}
        />
      </FieldGroup>
    </SettingsGroup>

    <SettingsGroup title={t('settings.about.maintenance')}>
      <FieldGroup className={SETTINGS_LIST_CLASS}>
        <SettingRow icon={RotateCw} title={t('settings.about.reloadClient')} description={t('settings.about.reloadDescription')} control={<Button variant="outline" size="sm" onClick={() => void run(window.api.system.reloadClient)}>{t('settings.about.reloadAction')}</Button>} />
        <SettingRow icon={FolderOpen} title={t('settings.about.clientLogs')} description={t('settings.about.logsDescription')} control={<Button variant="outline" size="sm" onClick={() => void run(window.api.system.revealLogs)}>{t('settings.about.openLogs')}</Button>} />
        <SettingRow icon={FolderOpen} title={t('settings.about.logRetention')} description={t('settings.about.logRetentionDescription')} control={<Input className="h-8 w-20 text-xs" type="number" min={1} max={365} aria-label={t('settings.about.logRetention')} aria-invalid={Boolean(form.formState.errors.logRetentionDays)} {...form.register('logRetentionDays', { valueAsNumber: true })} />} error={form.formState.errors.logRetentionDays?.message} invalid={Boolean(form.formState.errors.logRetentionDays)} />
      </FieldGroup>
    </SettingsGroup>

    {versionClicks >= 5 && <SettingsGroup title={t('settings.about.debug')}>
      <FieldGroup className={SETTINGS_LIST_CLASS}>
        <SettingRow icon={Bug} title={t('settings.about.devtools')} description={t('settings.about.devtoolsDescription')} control={<Button variant="outline" size="sm" onClick={() => void run(window.api.system.openDevtools)}>{t('settings.about.openDevtools')}</Button>} />
      </FieldGroup>
    </SettingsGroup>}
    {actionError && <p role="alert" className="text-xs text-destructive">{actionError}</p>}
  </div>
}

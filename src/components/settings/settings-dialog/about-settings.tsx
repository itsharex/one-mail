import { BadgeInfo, ExternalLink } from 'lucide-react'
import * as React from 'react'
import { openExternalUrl } from '@renderer/pages/mailbox/api'
import { UnderlineHover } from '@renderer/components/underline-hover'
import { Button } from '@renderer/components/ui/button'
import { FieldGroup } from '@renderer/components/ui/field'
import type{ AppUpdateStatus, SystemInfo } from '@renderer/shared/types'
import { useI18n } from '@renderer/lib/i18n'
import { ONEMAIL_HOMEPAGE_URL, hasAvailableUpdate } from '@renderer/lib/update-status'
import { SettingsGroup, SettingRow, SETTINGS_LIST_CLASS } from './settings-ui'

export function AboutSettings({
  systemInfo,
  updateStatus
}: {
  systemInfo: SystemInfo | null
  updateStatus: AppUpdateStatus | null
}): React.JSX.Element {
  const { t } = useI18n()
  const version = systemInfo?.appVersion ? `v${systemInfo.appVersion}` : t('common.loading')
  const hasUpdate = hasAvailableUpdate(updateStatus)
  const versionTitle =
    hasUpdate && updateStatus?.latestVersion
      ? t('settings.about.updateVersionTooltip', { version: updateStatus.latestVersion })
      : hasUpdate
        ? t('settings.about.updateAvailable')
        : undefined

  return (
    <div className="flex min-h-full w-full flex-col gap-3 p-3 sm:p-4">
      <SettingsGroup title={t('settings.about.appGroup')}>
        <FieldGroup className={SETTINGS_LIST_CLASS}>
          <SettingRow
            icon={BadgeInfo}
            iconClassName="bg-blue-500"
            title="OneMail"
            description={
              <span>
                {t('settings.about.versionPrefix')}{' '}
                {hasUpdate ? (
                  <UnderlineHover asChild>
                    <button
                      type="button"
                      className="rounded-sm font-medium text-warning outline-none transition-colors hover:text-warning focus-visible:ring-2 focus-visible:ring-ring"
                      title={versionTitle}
                      onClick={() => void openExternalUrl(ONEMAIL_HOMEPAGE_URL)}
                    >
                      {version}
                    </button>
                  </UnderlineHover>
                ) : (
                  <span>{version}</span>
                )}
                {t('settings.about.versionSuffix')}
              </span>
            }
            control={
              <UnderlineHover asChild>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void openExternalUrl('https://github.com/zhihui-hu/one-mail')}
                >
                  <ExternalLink data-icon="inline-start" />
                  GitHub
                </Button>
              </UnderlineHover>
            }
          />
        </FieldGroup>
      </SettingsGroup>
    </div>
  )
}

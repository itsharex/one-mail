import { CalendarRange, Clock3, FileText, Languages, Power, ShieldCheck } from 'lucide-react'
import * as React from 'react'
import { Controller, useForm } from 'react-hook-form'
import { FieldError, FieldGroup } from '@renderer/components/ui/field'
import { Input } from '@renderer/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/components/ui/select'
import { Switch } from '@renderer/components/ui/switch'
import { useI18n } from '@renderer/lib/i18n'
import type { SettingsFormValues } from './settings-form'
import { SettingsGroup, SettingRow, SETTINGS_LIST_CLASS } from './settings-ui'

export function GeneralSettingsForm({
  form,
  error
}: {
  form: ReturnType<typeof useForm<SettingsFormValues>>
  error: string | null
}): React.JSX.Element {
  const { t } = useI18n()

  return (
    <div className="flex min-h-full w-full flex-col gap-3 p-3 sm:p-4">
      <SettingsGroup title={t('settings.group.application')}>
        <FieldGroup className={SETTINGS_LIST_CLASS}>
          <Controller
            control={form.control}
            name="openAtLogin"
            render={({ field }) => (
              <SettingRow
                icon={Power}
                iconClassName="bg-blue-500"
                title={t('settings.openAtLogin.title')}
                description={t('settings.openAtLogin.description')}
                control={
                  <Switch
                    id="open-at-login"
                    size="sm"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                }
              />
            )}
          />

          <Controller
            control={form.control}
            name="locale"
            render={({ field }) => (
              <SettingRow
                icon={Languages}
                iconClassName="bg-indigo-500"
                title={t('settings.locale.title')}
                description={t('settings.locale.description')}
                control={
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger
                      id="locale"
                      size="sm"
                      className="w-32"
                      aria-invalid={Boolean(form.formState.errors.locale)}
                    >
                      <SelectValue placeholder={t('settings.locale.placeholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="zh-CN">{t('settings.locale.zhCN')}</SelectItem>
                        <SelectItem value="en-US">{t('settings.locale.enUS')}</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                }
                error={form.formState.errors.locale?.message}
                invalid={Boolean(form.formState.errors.locale)}
              />
            )}
          />
        </FieldGroup>
      </SettingsGroup>

      <SettingsGroup title={t('settings.group.sync')}>
        <FieldGroup className={SETTINGS_LIST_CLASS}>
          <SettingRow
            icon={Clock3}
            iconClassName="bg-emerald-500"
            title={t('settings.syncInterval.title')}
            description={t('settings.syncInterval.description')}
            control={
              <Input
                id="sync-interval-minutes"
                className="h-7 w-24 px-2 text-xs"
                type="number"
                min={0}
                max={1440}
                aria-invalid={Boolean(form.formState.errors.syncIntervalMinutes)}
                {...form.register('syncIntervalMinutes', { valueAsNumber: true })}
              />
            }
            error={form.formState.errors.syncIntervalMinutes?.message}
            invalid={Boolean(form.formState.errors.syncIntervalMinutes)}
          />

          <SettingRow
            icon={CalendarRange}
            iconClassName="bg-cyan-500"
            title={t('settings.syncWindow.title')}
            description={t('settings.syncWindow.description')}
            control={
              <Input
                id="sync-window-days"
                className="h-7 w-24 px-2 text-xs"
                type="number"
                min={1}
                max={3650}
                aria-invalid={Boolean(form.formState.errors.syncWindowDays)}
                {...form.register('syncWindowDays', { valueAsNumber: true })}
              />
            }
            error={form.formState.errors.syncWindowDays?.message}
            invalid={Boolean(form.formState.errors.syncWindowDays)}
          />
        </FieldGroup>
      </SettingsGroup>

      <SettingsGroup title={t('settings.group.privacy')}>
        <FieldGroup className={SETTINGS_LIST_CLASS}>
          <Controller
            control={form.control}
            name="bodyDisplayMode"
            render={({ field }) => (
              <SettingRow
                icon={FileText}
                iconClassName="bg-emerald-500"
                title={t('settings.bodyDisplay.title')}
                description={t('settings.bodyDisplay.description')}
                control={
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger size="sm" className="w-32" aria-label={t('settings.bodyDisplay.title')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="text">{t('settings.bodyDisplay.text')}</SelectItem>
                      <SelectItem value="html">{t('settings.bodyDisplay.html')}</SelectItem>
                    </SelectContent>
                  </Select>
                }
              />
            )}
          />
          <Controller
            control={form.control}
            name="externalImagesBlocked"
            render={({ field }) => (
              <SettingRow
                icon={ShieldCheck}
                iconClassName="bg-orange-500"
                title={t('settings.externalContent.title')}
                description={t('settings.externalContent.description')}
                control={
                  <Switch
                    id="external-images-blocked"
                    aria-label={t('settings.externalContent.title')}
                    size="sm"
                    checked={!field.value}
                    onCheckedChange={(checked) => field.onChange(!checked)}
                  />
                }
              />
            )}
          />
        </FieldGroup>
      </SettingsGroup>

      {error ? <FieldError className="px-1 text-xs">{error}</FieldError> : null}
    </div>
  )
}

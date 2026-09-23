import { CalendarRange, ChevronRight, Clock3, FileText, Languages, Power, ShieldCheck } from 'lucide-react'
import * as React from 'react'
import { Controller, useForm } from 'react-hook-form'
import { FieldError, FieldGroup } from '@renderer/components/ui/field'
import { Input } from '@renderer/components/ui/input'
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue,
} from '@renderer/components/ui/select'
import { Switch } from '@renderer/components/ui/switch'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@renderer/components/ui/collapsible'
import { useI18n } from '@renderer/lib/i18n'
import type { SettingsFormValues } from './settings-form'
import { SettingsGroup, SettingRow, SETTINGS_LIST_CLASS } from './settings-ui'

export function GeneralSettingsForm({ form, error }: {
  form: ReturnType<typeof useForm<SettingsFormValues>>
  error: string | null
}): React.JSX.Element {
  const { t } = useI18n()

  return <div className="flex flex-col gap-3">
    <SettingsGroup title={t('settings.group.sync')}>
      <FieldGroup className={SETTINGS_LIST_CLASS}>
        <SettingRow icon={Clock3} title={t('settings.syncInterval.title')} description={t('settings.syncInterval.description')}
          control={<Input id="sync-interval-minutes" className="h-8 w-20 text-xs" type="number" min={0} max={1440} aria-invalid={Boolean(form.formState.errors.syncIntervalMinutes)} {...form.register('syncIntervalMinutes', { valueAsNumber: true })} />}
          error={form.formState.errors.syncIntervalMinutes?.message} invalid={Boolean(form.formState.errors.syncIntervalMinutes)} />
      </FieldGroup>
    </SettingsGroup>

    <SettingsGroup title={t('settings.group.privacy')}>
      <FieldGroup className={SETTINGS_LIST_CLASS}>
        <Controller control={form.control} name="bodyDisplayMode" render={({ field }) => <SettingRow icon={FileText} title={t('settings.bodyDisplay.title')} description={t('settings.bodyDisplay.description')}
          control={<Select value={field.value} onValueChange={field.onChange}><SelectTrigger size="sm" className="w-28" aria-label={t('settings.bodyDisplay.title')}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="text">{t('settings.bodyDisplay.text')}</SelectItem><SelectItem value="html">{t('settings.bodyDisplay.html')}</SelectItem></SelectContent></Select>} />} />
        <Controller control={form.control} name="externalImagesBlocked" render={({ field }) => <SettingRow icon={ShieldCheck} title={t('settings.externalContent.title')} description={t('settings.externalContent.description')}
          control={<Switch id="external-images-blocked" aria-label={t('settings.externalContent.title')} size="sm" checked={!field.value} onCheckedChange={(checked) => field.onChange(!checked)} />} />} />
      </FieldGroup>
    </SettingsGroup>

    <SettingsGroup title={t('settings.group.application')}>
      <FieldGroup className={SETTINGS_LIST_CLASS}>
        <Controller control={form.control} name="locale" render={({ field }) => <SettingRow icon={Languages} title={t('settings.locale.title')} description={t('settings.locale.description')}
          control={<Select value={field.value} onValueChange={field.onChange}><SelectTrigger id="locale" size="sm" className="w-28" aria-invalid={Boolean(form.formState.errors.locale)}><SelectValue placeholder={t('settings.locale.placeholder')} /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="zh-CN">{t('settings.locale.zhCN')}</SelectItem><SelectItem value="en-US">{t('settings.locale.enUS')}</SelectItem></SelectGroup></SelectContent></Select>} error={form.formState.errors.locale?.message} invalid={Boolean(form.formState.errors.locale)} />} />
        <Controller control={form.control} name="openAtLogin" render={({ field }) => <SettingRow icon={Power} title={t('settings.openAtLogin.title')} description={t('settings.openAtLogin.description')}
          control={<Switch id="open-at-login" size="sm" checked={field.value} onCheckedChange={field.onChange} />} />} />
      </FieldGroup>
    </SettingsGroup>

    <Collapsible defaultOpen className="overflow-hidden rounded-lg bg-background">
      <CollapsibleTrigger className="group flex w-full items-center gap-1.5 border-b border-transparent px-3 py-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground data-[state=open]:border-border/40">
        <ChevronRight className="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-90" aria-hidden="true" />
        {t('settings.general.advanced')}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <SettingRow icon={CalendarRange} title={t('settings.syncWindow.title')} description={t('settings.syncWindow.description')}
          control={<Input id="sync-window-days" className="h-8 w-20 text-xs" type="number" min={1} max={3650} aria-invalid={Boolean(form.formState.errors.syncWindowDays)} {...form.register('syncWindowDays', { valueAsNumber: true })} />}
          error={form.formState.errors.syncWindowDays?.message} invalid={Boolean(form.formState.errors.syncWindowDays)} />
      </CollapsibleContent>
    </Collapsible>
    {error && <FieldError className="text-xs">{error}</FieldError>}
  </div>
}

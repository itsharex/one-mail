import { z } from 'zod'
import type { AppSettings } from '@renderer/shared/types'
import type { TranslationKey } from '@renderer/lib/i18n'

export type SettingsFormValues = {
  bodyDisplayMode: 'text' | 'html'
  syncIntervalMinutes: number
  syncWindowDays: number
  openAtLogin: boolean
  externalImagesBlocked: boolean
  locale: 'zh-CN' | 'en-US'
}

export function createSettingsSchema(t: (key: TranslationKey) => string) {
  return z.object({
    syncIntervalMinutes: z.coerce
      .number<number>(t('settings.syncInterval.errorRequired'))
      .int(t('settings.syncInterval.errorInteger'))
      .min(0, t('settings.syncInterval.errorMin'))
      .max(1440, t('settings.syncInterval.errorMax')),
    syncWindowDays: z.coerce
      .number<number>(t('settings.syncWindow.errorRequired'))
      .int(t('settings.syncWindow.errorInteger'))
      .min(1, t('settings.syncWindow.errorMin'))
      .max(3650, t('settings.syncWindow.errorMax')),
    openAtLogin: z.boolean(),
    externalImagesBlocked: z.boolean(),
    bodyDisplayMode: z.enum(['text', 'html']),
    locale: z.enum(['zh-CN', 'en-US'])
  })
}

export function toFormValues(settings: AppSettings | null): SettingsFormValues {
  return {
    syncIntervalMinutes: settings?.syncIntervalMinutes ?? 15,
    syncWindowDays: settings?.syncWindowDays ?? 90,
    openAtLogin: settings?.openAtLogin === true,
    externalImagesBlocked: settings?.externalImagesBlocked !== false,
    bodyDisplayMode: settings?.bodyDisplayMode === 'html' ? 'html' : 'text',
    locale: settings?.locale === 'en-US' ? 'en-US' : 'zh-CN'
  }
}

export function areSettingsEqual(first: SettingsFormValues, second: SettingsFormValues): boolean {
  return (
    first.syncIntervalMinutes === second.syncIntervalMinutes &&
    first.syncWindowDays === second.syncWindowDays &&
    first.openAtLogin === second.openAtLogin &&
    first.externalImagesBlocked === second.externalImagesBlocked &&
    first.bodyDisplayMode === second.bodyDisplayMode &&
    first.locale === second.locale
  )
}

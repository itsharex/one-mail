import { zhCNCommonSettings } from './i18n/zh-cn-common-settings'
import { zhCNAccounts } from './i18n/zh-cn-accounts'
import { zhCNMailAndStatus } from './i18n/zh-cn-mail-and-status'
import { enUSCommonSettings } from './i18n/en-us-common-settings'
import { enUSAccounts } from './i18n/en-us-accounts'
import { enUSMailAndStatus } from './i18n/en-us-mail-and-status'
import * as React from 'react'

export const supportedLocales = ['zh-CN', 'en-US'] as const
export type AppLocale = (typeof supportedLocales)[number]

type I18nContextValue = {
  locale: AppLocale
  setLocale: (locale: AppLocale) => void
  t: (key: TranslationKey, values?: TranslationValues) => string
}

type TranslationValues = Record<string, string | number>
type TranslationMap = Record<TranslationKey, string>
export type TranslationKey = keyof typeof zhCN

const zhCN = {
  ...zhCNCommonSettings,
  ...zhCNAccounts,
  ...zhCNMailAndStatus
}

const enUS: TranslationMap = {
  ...enUSCommonSettings,
  ...enUSAccounts,
  ...enUSMailAndStatus
}

const translations: Record<AppLocale, TranslationMap> = {
  'zh-CN': zhCN,
  'en-US': enUS
}

const I18nContext = React.createContext<I18nContextValue | null>(null)

export function I18nProvider({
  initialLocale = 'zh-CN',
  children
}: {
  initialLocale?: string
  children: React.ReactNode
}): React.JSX.Element {
  const [locale, setLocaleState] = React.useState<AppLocale>(() => normalizeLocale(initialLocale))

  const setLocale = React.useCallback((nextLocale: AppLocale): void => {
    setLocaleState(nextLocale)
  }, [])

  React.useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const value = React.useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      t: (key, values) => formatTranslation(translations[locale][key] ?? zhCN[key], values)
    }),
    [locale, setLocale]
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
  const value = React.useContext(I18nContext)
  if (!value) throw new Error('useI18n must be used within I18nProvider')
  return value
}

export function translate(
  locale: AppLocale,
  key: TranslationKey,
  values?: TranslationValues
): string {
  return formatTranslation(translations[locale][key] ?? zhCN[key], values)
}

export function normalizeLocale(value?: string | null): AppLocale {
  return value === 'en-US' ? 'en-US' : 'zh-CN'
}

function formatTranslation(template: string, values?: TranslationValues): string {
  if (!values) return template

  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = values[key]
    return value === undefined ? match : String(value)
  })
}

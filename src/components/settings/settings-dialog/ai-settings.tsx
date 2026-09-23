import { Bot, CheckCircle2, ShieldCheck, Trash2 } from 'lucide-react'
import * as React from 'react'
import { SweepShine } from '@renderer/components/sweep-shine'
import { Button } from '@renderer/components/ui/button'
import { Field, FieldError, FieldGroup, FieldLabel } from '@renderer/components/ui/field'
import { Input } from '@renderer/components/ui/input'
import { Alert, AlertTitle } from '@renderer/components/ui/alert'
import type{ AiSettings, AiSettingsInput } from '@renderer/shared/types'
import { useI18n } from '@renderer/lib/i18n'
import { SettingsGroup, SettingsHelp, SETTINGS_LIST_CLASS } from './settings-ui'

export function AiSettingsForm({
  settings,
  onVerify,
  onClear
}: {
  settings: AiSettings | null
  onVerify: (input: AiSettingsInput) => Promise<AiSettings>
  onClear: () => Promise<AiSettings>
}): React.JSX.Element {
  const { t } = useI18n()
  const [baseUrl, setBaseUrl] = React.useState(settings?.baseUrl ?? '')
  const [model, setModel] = React.useState(settings?.model ?? '')
  const [apiKey, setApiKey] = React.useState('')
  const [pending, setPending] = React.useState<'verify' | 'clear' | null>(null)
  const [message, setMessage] = React.useState<string | null>(null)
  const [formError, setFormError] = React.useState<string | null>(null)

  React.useEffect(() => {
    setBaseUrl(settings?.baseUrl ?? '')
    setModel(settings?.model ?? '')
    setApiKey('')
  }, [settings])

  const loopbackService = isLoopbackHttpUrl(baseUrl.trim().replace(/\/+$/, ''))

  React.useEffect(() => {
    if (loopbackService) setApiKey('')
  }, [loopbackService])

  async function handleVerify(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, '')
    const normalizedModel = model.trim()
    const nextApiKey = isLoopbackHttpUrl(normalizedBaseUrl) ? '' : apiKey.trim()
    const savedBaseUrl = settings?.baseUrl.trim().replace(/\/+$/, '') ?? ''
    const canReuseConfiguredKey =
      settings?.apiKeyConfigured === true && normalizedBaseUrl === savedBaseUrl

    if (!normalizedBaseUrl) {
      setFormError(t('settings.ai.baseUrlRequired'))
      return
    }
    if (!isAllowedAiUrl(normalizedBaseUrl)) {
      setFormError(t('settings.ai.baseUrlInvalid'))
      return
    }
    if (!normalizedModel) {
      setFormError(t('settings.ai.modelRequired'))
      return
    }
    if (!canReuseConfiguredKey && !nextApiKey && !isLoopbackHttpUrl(normalizedBaseUrl)) {
      setFormError(t('settings.ai.apiKeyRequired'))
      return
    }

    setPending('verify')
    setMessage(null)
    setFormError(null)
    try {
      const nextSettings = await onVerify({
        baseUrl: normalizedBaseUrl,
        model: normalizedModel,
        ...(nextApiKey ? { apiKey: nextApiKey } : {})
      })
      setBaseUrl(nextSettings.baseUrl)
      setModel(nextSettings.model)
      setApiKey('')
      setMessage(t('settings.ai.verifiedSuccess'))
    } catch (verifyError) {
      setFormError(
        verifyError instanceof Error ? verifyError.message : t('settings.ai.verifyError')
      )
    } finally {
      setPending(null)
    }
  }

  async function handleClear(): Promise<void> {
    setPending('clear')
    setMessage(null)
    setFormError(null)
    try {
      const nextSettings = await onClear()
      setBaseUrl(nextSettings.baseUrl)
      setModel(nextSettings.model)
      setApiKey('')
      setMessage(t('settings.ai.clearedSuccess'))
    } catch (clearError) {
      setFormError(
        clearError instanceof Error ? clearError.message : t('settings.ai.clearError')
      )
    } finally {
      setPending(null)
    }
  }

  const configured = settings?.apiKeyConfigured === true
  const draftChanged =
    baseUrl.trim().replace(/\/+$/, '') !== (settings?.baseUrl.trim().replace(/\/+$/, '') ?? '') ||
    model.trim() !== (settings?.model.trim() ?? '') ||
    Boolean(apiKey.trim())
  const verified = settings?.verified === true && !draftChanged
  const canClear = Boolean(configured || settings?.baseUrl || settings?.model)
  const apiKeyPlaceholder = loopbackService
    ? t('settings.ai.apiKeyLocalPlaceholder')
    : configured
      ? t('settings.ai.apiKeyKeepPlaceholder')
      : t('settings.ai.apiKeyPlaceholder')
  const apiKeyDescription = loopbackService
    ? t('settings.ai.apiKeyLocalDescription')
    : configured
      ? t('settings.ai.apiKeyConfiguredDescription')
      : t('settings.ai.apiKeyDescription')

  return (
    <form className="flex w-full flex-col gap-3" onSubmit={handleVerify}>
      <SettingsGroup title={t('settings.ai.connectionGroup')}>
        <FieldGroup className={SETTINGS_LIST_CLASS}>
          <Field orientation="horizontal" className="min-h-10 items-center gap-2 px-3 py-1.5">
            <div className="flex min-w-28 shrink-0 items-center gap-1"><FieldLabel htmlFor="ai-base-url" className="text-xs font-medium">{t('settings.ai.baseUrl')}</FieldLabel><SettingsHelp description={t('settings.ai.baseUrlDescription')} /></div>
            <Input
              id="ai-base-url"
              className="h-8 min-w-0 flex-1 text-xs"
              type="url"
              value={baseUrl}
              disabled={Boolean(pending)}
              placeholder="https://api.example.com/v1"
              autoComplete="url"
              onChange={(event) => {
                setBaseUrl(event.target.value)
                setMessage(null)
                setFormError(null)
              }}
            />
          </Field>

          <Field orientation="horizontal" className="min-h-10 items-center gap-2 px-3 py-1.5">
            <div className="flex min-w-28 shrink-0 items-center gap-1"><FieldLabel htmlFor="ai-model" className="text-xs font-medium">{t('settings.ai.model')}</FieldLabel><SettingsHelp description={t('settings.ai.modelDescription')} /></div>
            <Input
              id="ai-model"
              className="h-8 min-w-0 flex-1 text-xs"
              value={model}
              disabled={Boolean(pending)}
              placeholder="model-name"
              autoComplete="off"
              onChange={(event) => {
                setModel(event.target.value)
                setMessage(null)
                setFormError(null)
              }}
            />
          </Field>

          <Field orientation="horizontal" className="min-h-10 items-center gap-2 px-3 py-1.5">
            <div className="flex min-w-28 shrink-0 items-center gap-1"><FieldLabel htmlFor="ai-api-key" className="text-xs font-medium">{t('settings.ai.apiKey')}</FieldLabel><SettingsHelp description={apiKeyDescription} /></div>
            <Input
              id="ai-api-key"
              className="h-8 min-w-0 flex-1 text-xs"
              type="password"
              value={apiKey}
              disabled={Boolean(pending) || loopbackService}
              placeholder={apiKeyPlaceholder}
              autoComplete="new-password"
              onChange={(event) => {
                setApiKey(event.target.value)
                setMessage(null)
                setFormError(null)
              }}
            />
          </Field>
        </FieldGroup>
      </SettingsGroup>

      <SettingsGroup title={t('settings.ai.statusGroup')}>
        <div className={`${SETTINGS_LIST_CLASS} flex min-h-10 items-center gap-2.5 px-3 py-1.5`}>
          <div
            className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/70 text-muted-foreground"
          >
            {verified ? <CheckCircle2 className="size-3.5" /> : <Bot className="size-3.5" />}
          </div>
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <div className="text-xs font-medium">
              {verified ? t('settings.ai.statusVerified') : t('settings.ai.statusNotVerified')}
            </div>
            {verified && settings?.verifiedAt ? <span className="truncate text-xs text-muted-foreground">{t('settings.ai.verifiedAt', { time: formatAiVerifiedAt(settings.verifiedAt) })}</span> : <SettingsHelp description={t('settings.ai.statusDescription')} />}
          </div>
        </div>
      </SettingsGroup>

      <SettingsGroup title={t('settings.ai.privacyGroup')}>
        <div className={`${SETTINGS_LIST_CLASS} flex min-h-10 items-center gap-2.5 px-3 py-1.5`}>
          <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/70 text-muted-foreground">
            <ShieldCheck className="size-3.5" aria-hidden="true" />
          </div>
          <div className="flex min-w-0 items-center gap-1.5">
            <div className="text-xs font-medium">{t('settings.ai.privacyTitle')}</div>
            <SettingsHelp description={t('settings.ai.privacyDescription')} />
          </div>
        </div>
      </SettingsGroup>

      {message ? (
        <Alert>
          <AlertTitle>{message}</AlertTitle>
        </Alert>
      ) : null}
      {formError ? <FieldError className="px-1 text-xs">{formError}</FieldError> : null}

      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="destructive"
          disabled={Boolean(pending) || !canClear}
          onClick={() => void handleClear()}
        >
          <Trash2 data-icon="inline-start" />
          {pending === 'clear' ? (
            <SweepShine>{t('settings.ai.clearing')}</SweepShine>
          ) : (
            t('settings.ai.clear')
          )}
        </Button>
        <Button type="submit" disabled={Boolean(pending)}>
          <CheckCircle2 data-icon="inline-start" />
          {pending === 'verify' ? (
            <SweepShine>{t('settings.ai.verifying')}</SweepShine>
          ) : (
            t('settings.ai.verifyAndSave')
          )}
        </Button>
      </div>
    </form>
  )
}

function isAllowedAiUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.username || url.password || url.search || url.hash) return false
    return url.protocol === 'https:' || isLoopbackHttpUrl(value)
  } catch {
    return false
  }
}

function isLoopbackHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname.toLowerCase())
    )
  } catch {
    return false
  }
}

function formatAiVerifiedAt(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

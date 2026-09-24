import { zodResolver } from '@hookform/resolvers/zod'
import * as React from 'react'
import { useForm } from 'react-hook-form'

import { UnderlineHover } from '@renderer/components/underline-hover'
import { Alert, AlertDescription } from '@renderer/components/ui/alert'
import { Button } from '@renderer/components/ui/button'
import { FieldError, FieldGroup } from '@renderer/components/ui/field'
import { useI18n } from '@renderer/lib/i18n'
import { getProviderLogoMetadata } from '@renderer/shared/provider-metadata'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import type { AccountCreateInput } from '@renderer/shared/types'
import {
  createAccountSchema,
  defaultAccountFormValues,
  getProviderPreset,
  normalizeAccountPassword,
  providerPresets,
  resolveProviderPreset,
  type AccountFormValues,
  type AccountKind
} from './account-form-types'
import { AccountFormField } from './account-form-field'
import { CommonAccountFields } from './common-account-fields'
import { CustomImapAccountForm } from './custom-imap-account-form'
import { GmailAccountForm } from './gmail-account-form'
import { ImapFolderSelector } from './imap-folder-selector'
import { OutlookAccountForm } from './outlook-account-form'

const ACCOUNT_ADD_GUIDE_URL =
  'https://huzhihui.com/blog/personal-email-account-add-guide-imap-smtp-app-password'

type AddAccountFormProps = {
  onSubmit: (input: AccountCreateInput) => Promise<void>
  className?: string
  bodyClassName?: string
  footerClassName?: string
}

export function AddAccountForm({
  onSubmit,
  className = 'flex min-h-0 flex-col gap-3',
  bodyClassName = 'flex flex-col gap-3',
  footerClassName = 'flex justify-end'
}: AddAccountFormProps): React.JSX.Element {
  const { t } = useI18n()
  const accountSchema = React.useMemo(() => createAccountSchema(t), [t])
  const [error, setError] = React.useState<string | null>(null)
  const form = useForm<AccountFormValues>({
    resolver: zodResolver(accountSchema),
    defaultValues: defaultAccountFormValues,
    mode: 'onSubmit'
  })
  const kind = form.watch('kind')
  const currentAuthType = form.watch('authType')

  function handleKindChange(nextKind: string): void {
    const preset = getProviderPreset(nextKind as AccountKind)

    form.setValue('kind', preset.kind)
    form.setValue('providerKey', preset.providerKey)
    form.setValue('authType', preset.authType)
    form.setValue('imapHost', preset.imapHost)
    form.setValue('imapPort', preset.imapPort)
    form.setValue('imapSecurity', preset.imapSecurity)
    form.setValue('smtpHost', preset.smtpHost ?? '')
    form.setValue('smtpPort', preset.smtpPort ?? 465)
    form.setValue('smtpSecurity', preset.smtpSecurity ?? 'ssl_tls')
    form.setValue('smtpEnabled', preset.smtpEnabled ?? false)
    form.setValue('syncFolders', [])
    form.clearErrors()
    setError(null)
  }

  async function handleSubmit(values: AccountFormValues): Promise<void> {
    setError(null)

    const preset = resolveProviderPreset(values.kind, values.email)
    const authType = values.kind === 'gmail' ? values.authType : preset.authType
    const smtpAuthType =
      values.kind === 'gmail' ? (authType === 'oauth2' ? 'oauth2' : 'app_password') : preset.smtpAuthType
    const smtpEnabled = values.kind === 'custom' ? values.smtpEnabled : preset.smtpEnabled

    try {
      await onSubmit({
        providerKey: preset.providerKey,
        email: values.email?.trim(),
        password: values.password ? normalizeAccountPassword(values.password, authType) : undefined,
        accountLabel: optionalText(values.accountLabel),
        authType,
        oauthAuthorizationMode: authType === 'oauth2' ? 'system_browser' : undefined,
        imapHost:
          values.kind === 'custom' ? values.imapHost?.trim() || preset.imapHost : preset.imapHost,
        imapPort: values.kind === 'custom' ? values.imapPort : preset.imapPort,
        imapSecurity: values.kind === 'custom' ? values.imapSecurity : preset.imapSecurity,
        smtpHost:
          values.kind === 'custom'
            ? smtpEnabled
              ? optionalText(values.smtpHost)
              : undefined
            : preset.smtpHost,
        smtpPort: values.kind === 'custom' ? (smtpEnabled ? values.smtpPort : undefined) : preset.smtpPort,
        smtpSecurity:
          values.kind === 'custom'
            ? smtpEnabled
              ? values.smtpSecurity
              : undefined
            : preset.smtpSecurity,
        smtpAuthType: values.kind === 'custom' ? (smtpEnabled ? authType : undefined) : smtpAuthType,
        smtpEnabled,
        syncFolders:
          authType !== 'oauth2' && values.syncFolders.length > 0 ? values.syncFolders : undefined
      })
      form.reset(defaultAccountFormValues)
    } catch (submitError) {
      setError(formatAccountSubmitError(submitError, t('account.add.saveError'), values.kind))
    }
  }

  return (
    <form
      id="add-account-form"
      className={className}
      noValidate
      onSubmit={form.handleSubmit((values) => handleSubmit(values))}
    >
      <div className={bodyClassName}>
        {error ? (
          <FieldError className="rounded-md border border-destructive/25 bg-destructive/5 p-2 text-xs leading-5">
            {error}
          </FieldError>
        ) : null}

        <AccountFormField id="account-kind" label={t('account.form.type')} required>
          <Select value={kind} onValueChange={handleKindChange} required>
            <SelectTrigger id="account-kind" aria-label={t('account.form.type')} className="w-full">
              <SelectValue>
                <span className="flex min-w-0 items-center gap-2">
                  <ProviderNetworkLogo key={kind} providerKey={getProviderPreset(kind).providerKey} />
                  {t(getProviderPreset(kind).labelKey)}
                </span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent viewportClassName="max-h-64 overflow-y-auto">
              <SelectGroup>
                {providerPresets.map((preset) => (
                  <SelectItem key={preset.kind} value={preset.kind}>
                    <ProviderNetworkLogo providerKey={preset.providerKey} />
                    {t(preset.labelKey)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </AccountFormField>

        <AccountAddGuideHint kind={kind} />

        <FieldGroup className="gap-2.5">
          {renderProviderForm(kind, form, t)}
          {currentAuthType !== 'oauth2' ? <ImapFolderSelector form={form} kind={kind} /> : null}
        </FieldGroup>
      </div>

      <div className={footerClassName}>
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting
            ? kind === 'outlook' || (kind === 'gmail' && currentAuthType === 'oauth2')
              ? t('account.add.waitingAuth')
              : t('common.testing')
            : kind === 'outlook'
              ? t('account.add.microsoftLogin')
              : kind === 'gmail' && currentAuthType === 'oauth2'
                ? t('account.add.googleLogin')
                : t('account.add.saveAccount')}
        </Button>
      </div>
    </form>
  )
}

function ProviderNetworkLogo({ providerKey }: { providerKey: string }): React.JSX.Element {
  const { domain, fallback } = getProviderLogoMetadata(providerKey)
  const [failed, setFailed] = React.useState(false)

  return (
    <span className="flex size-5 shrink-0 items-center justify-center overflow-hidden rounded bg-white text-[10px] font-semibold text-muted-foreground ring-1 ring-border/60">
      {domain && !failed ? (
        <img
          src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`}
          alt=""
          aria-hidden="true"
          className="size-4 object-contain"
          onError={() => setFailed(true)}
        />
      ) : (
        <span aria-hidden="true">{fallback}</span>
      )}
    </span>
  )
}

function renderProviderForm(
  kind: AccountKind,
  form: ReturnType<typeof useForm<AccountFormValues>>,
  t: ReturnType<typeof useI18n>['t']
): React.JSX.Element {
  if (kind === 'outlook') return <OutlookAccountForm form={form} />
  if (kind === 'gmail') return <GmailAccountForm form={form} />
  if (kind === 'custom') return <CustomImapAccountForm form={form} />

  const preset = getProviderPreset(kind)

  return (
    <CommonAccountFields
      form={form}
      passwordLabel={t(preset.passwordLabelKey ?? 'account.form.passwordOrAuthCode')}
      passwordPlaceholder={t(preset.passwordPlaceholderKey ?? 'account.form.passwordPlaceholder')}
    />
  )
}

function AccountAddGuideHint({ kind }: { kind: AccountKind }): React.JSX.Element {
  const { t } = useI18n()
  const preset = getProviderPreset(kind)
  const label = t(preset.labelKey)

  return (
    <Alert variant="warning">
      <AlertDescription className="text-xs leading-5">
        {getAccountGuideText(kind, label, t)}
        <UnderlineHover asChild>
          <a href={ACCOUNT_ADD_GUIDE_URL} target="_blank" rel="noreferrer">
            {t('account.add.guideLink')}
          </a>
        </UnderlineHover>
      </AlertDescription>
    </Alert>
  )
}

function getAccountGuideText(
  kind: AccountKind,
  label: string,
  t: ReturnType<typeof useI18n>['t']
): string {
  const preset = getProviderPreset(kind)
  if (preset.guideKey) return t(preset.guideKey, { label })

  if (kind === 'custom') return t('account.add.guide.custom')

  return t('account.add.guide.default', { label })
}

function optionalText(value?: string): string | undefined {
  const text = value?.trim()
  return text ? text : undefined
}

function formatAccountSubmitError(error: unknown, fallback: string, kind: AccountKind): string {
  if (!(error instanceof Error)) return fallback

  const message = error.message
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim()

  if (kind === 'aliyunEnterprise' && /IMAP 登录认证失败：.*LOGIN failed/i.test(message)) {
    return [
      '阿里企业邮箱登录认证失败：服务器拒绝了当前账号或密码/专用密码。',
      '请让管理员确认已允许使用三方客户端，并已为当前账号开启 IMAP/SMTP 服务；服务器为 imap.qiye.aliyun.com，SSL 端口 993。',
      '如果企业强制启用或账号已开启三方客户端安全密码，请在网页端生成安全密码，并在这里填写该密码，不要使用网页登录密码。',
      '如果企业限制了三方客户端安全登录 IP，请确认当前网络 IP 已被允许。'
    ].join(' ')
  }

  return message
}

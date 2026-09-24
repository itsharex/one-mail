import type * as React from 'react'
import { Controller, type UseFormReturn } from 'react-hook-form'

import { FieldLabel, FieldLegend, FieldSet } from '@renderer/components/ui/field'
import { Input } from '@renderer/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@renderer/components/ui/radio-group'
import { useI18n } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import type { AccountFormValues } from './account-form-types'
import { AccountFormField } from './account-form-field'

type GmailAccountFormProps = {
  form: UseFormReturn<AccountFormValues>
}

export function GmailAccountForm({ form }: GmailAccountFormProps): React.JSX.Element {
  const { t } = useI18n()
  const usesOAuth = form.watch('authType') === 'oauth2'

  return (
    <>
      <AccountFormField
        id="account-email"
        label={t('account.form.email')}
        required={!usesOAuth}
        error={form.formState.errors.email?.message}
      >
        <Input
          id="account-email"
          type="email"
          autoComplete="email"
          placeholder="name@gmail.com"
          required={!usesOAuth}
          aria-invalid={Boolean(form.formState.errors.email)}
          aria-describedby={form.formState.errors.email ? 'account-email-error' : undefined}
          {...form.register('email')}
        />
      </AccountFormField>

      <FieldSet className="gap-2">
        <FieldLegend id="gmail-auth-legend" variant="label" className="mb-0">
          {t('account.form.authMethod')}
        </FieldLegend>
        <Controller
          control={form.control}
          name="authType"
          render={({ field }) => (
            <RadioGroup
              value={field.value}
              onValueChange={(value) => {
                field.onChange(value)
                form.clearErrors(['email', 'password'])
              }}
              aria-labelledby="gmail-auth-legend"
              className="gap-2"
            >
              <FieldLabel
                htmlFor="gmail-oauth"
                className={cn(
                  'flex w-full cursor-pointer items-center gap-2.5 rounded-lg border bg-background px-3 py-2.5 text-sm font-medium hover:bg-muted/40',
                  usesOAuth && 'border-primary/50 bg-primary/5'
                )}
              >
                <RadioGroupItem id="gmail-oauth" value="oauth2" />
                {t('account.form.googleLogin')}
              </FieldLabel>
              <FieldLabel
                htmlFor="gmail-app-password"
                className={cn(
                  'flex w-full cursor-pointer items-center gap-2.5 rounded-lg border bg-background px-3 py-2.5 text-sm font-medium hover:bg-muted/40',
                  !usesOAuth && 'border-primary/50 bg-primary/5'
                )}
              >
                <RadioGroupItem id="gmail-app-password" value="app_password" />
                {t('account.form.gmailAppPassword')}
              </FieldLabel>
            </RadioGroup>
          )}
        />
      </FieldSet>

      {usesOAuth ? (
        <p className="text-xs leading-5 text-muted-foreground">
          {t('account.form.googleLoginDescription')}
        </p>
      ) : (
        <AccountFormField
          id="account-password"
          label={t('account.form.appPassword')}
          required
          error={form.formState.errors.password?.message}
        >
          <Input
            id="account-password"
            type="password"
            autoComplete="current-password"
            placeholder={t('account.form.gmailPasswordPlaceholder')}
            required
            aria-invalid={Boolean(form.formState.errors.password)}
            aria-describedby={form.formState.errors.password ? 'account-password-error' : undefined}
            {...form.register('password')}
          />
        </AccountFormField>
      )}

      <AccountFormField
        id="account-label"
        label={t('account.form.label')}
        error={form.formState.errors.accountLabel?.message}
      >
        <Input
          id="account-label"
          autoComplete="off"
          placeholder={t('account.form.labelPlaceholder')}
          aria-invalid={Boolean(form.formState.errors.accountLabel)}
          aria-describedby={form.formState.errors.accountLabel ? 'account-label-error' : undefined}
          {...form.register('accountLabel')}
        />
      </AccountFormField>
    </>
  )
}

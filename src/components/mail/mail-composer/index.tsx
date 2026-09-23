import * as React from 'react'
import {
  Maximize2,
  Minimize2,
  Paperclip,
  Save,
  Send,
  Trash2,
  X
} from 'lucide-react'

import { AddressInput } from '@renderer/components/mail/address-input'
import { MailBodyEditor } from '@renderer/components/mail/mail-composer/body-editor'
import {
  ComposerFieldLabel,
  ComposerToolButton,
  RecipientDisclosure
} from '@renderer/components/mail/mail-composer/composer-fields'
import {
  createFormState,
  formatAttachmentTotal,
  formatBytes,
  getAttachmentKey,
  getDraftKey,
  getUnselectedForwardAttachments,
  hasDraftContent,
  normalizeComposerHtml,
  resolveFormPatch,
  type ComposerFormState
} from '@renderer/components/mail/mail-composer/composer-state'
import type { Account } from '@renderer/components/mail/types'
import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { Field, FieldError, FieldGroup } from '@renderer/components/ui/field'
import { Input } from '@renderer/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@renderer/components/ui/native-select'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@renderer/components/ui/tooltip'
import {
  selectMailAttachments,
  type ComposeDraft,
  type SendMessageInput
} from '@renderer/pages/mailbox/api'
import { useI18n } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import type { MailAttachmentInput } from '@renderer/shared/types'

export { getAttachmentKey, getUnselectedForwardAttachments } from '@renderer/components/mail/mail-composer/composer-state'

const COMPOSER_ADDRESS_FIELD_CLASS =
  'min-h-9 items-center gap-2 border-b px-3 py-1 *:data-[slot=field-label]:flex-none'

type MailComposerProps = {
  open: boolean
  accounts: Account[]
  draft: ComposeDraft | null
  pending?: boolean
  onOpenChange: (open: boolean) => void
  onSend: (input: SendMessageInput) => Promise<void>
  onSaveDraft: (input: SendMessageInput) => Promise<void>
  onDiscardDraft?: (draftId: number) => Promise<void>
}

export function MailComposer({
  open,
  accounts,
  draft,
  pending = false,
  onOpenChange,
  onSend,
  onSaveDraft,
  onDiscardDraft
}: MailComposerProps): React.JSX.Element {
  const { t } = useI18n()
  const sendAccounts = accounts.filter((account) => account.accountId)
  const draftKey = getDraftKey(draft)
  const [expanded, setExpanded] = React.useState(false)
  const [ccVisible, setCcVisible] = React.useState(Boolean(draft?.cc?.length))
  const [bccVisible, setBccVisible] = React.useState(Boolean(draft?.bcc?.length))
  const [formState, setFormState] = React.useState<ComposerFormState>(() =>
    createFormState(draft, draftKey)
  )
  const form = formState.draftKey === draftKey ? formState : createFormState(draft, draftKey)
  const defaultAccount = sendAccounts.find(
    (account) => String(account.accountId) === form.accountId
  )
  const unselectedForwardAttachments = getUnselectedForwardAttachments(draft, form.attachments)

  async function handleSubmit(action: 'send' | 'draft'): Promise<void> {
    if (!draft) return
    if (action === 'send' && form.to.length === 0) {
      updateForm({ error: t('mail.composer.errorRecipientRequired') })
      return
    }

    const input = createSubmitInput()
    if (!input) return

    if (action === 'send') {
      await onSend(input)
    } else {
      await onSaveDraft(input)
    }
    setExpanded(false)
  }

  function createSubmitInput(): SendMessageInput | null {
    if (!draft) return null
    const numericAccountId = Number(form.accountId)
    if (!numericAccountId) {
      updateForm({ error: t('mail.composer.errorAccountRequired') })
      return null
    }

    updateForm({ error: null })
    return {
      draftId: draft.draftId,
      kind: draft.kind,
      accountId: numericAccountId,
      relatedMessageId: draft.relatedMessageId,
      to: form.to,
      cc: form.cc,
      bcc: form.bcc,
      subject: form.subject.trim(),
      bodyText: form.bodyText,
      bodyHtml: normalizeComposerHtml(form.bodyHtml),
      attachments: form.attachments,
      inReplyTo: draft.inReplyTo,
      references: draft.references
    }
  }

  async function handleSelectAttachments(): Promise<void> {
    try {
      const selected = await selectMailAttachments()
      if (selected.length === 0) return
      updateForm((current) => {
        const existingPaths = new Set(current.attachments.map(getAttachmentKey))
        return {
          attachments: [
            ...current.attachments,
            ...selected.filter((attachment) => !existingPaths.has(getAttachmentKey(attachment)))
          ],
          error: null
        }
      })
    } catch (error) {
      updateForm({
        error: error instanceof Error ? error.message : t('mail.composer.errorSelectAttachment')
      })
    }
  }

  function removeAttachment(target: MailAttachmentInput): void {
    const targetKey = getAttachmentKey(target)
    updateForm((current) => ({
      attachments: current.attachments.filter(
        (attachment) => getAttachmentKey(attachment) !== targetKey
      )
    }))
  }

  function updateForm(
    patch:
      | Partial<Omit<ComposerFormState, 'draftKey'>>
      | ((
          current: Omit<ComposerFormState, 'draftKey'>
        ) => Partial<Omit<ComposerFormState, 'draftKey'>>)
  ): void {
    setFormState((current) => ({
      ...resolveFormPatch(current, draft, draftKey, patch)
    }))
  }

  function handleClose(): void {
    setExpanded(false)
    onOpenChange(false)
  }

  async function handleSaveAndClose(): Promise<void> {
    if (!hasDraftContent(form)) {
      handleClose()
      return
    }

    const input = createSubmitInput()
    if (!input) return
    await onSaveDraft(input)
    setExpanded(false)
  }

  async function handleDiscard(): Promise<void> {
    if (!draft?.draftId || !onDiscardDraft) {
      handleClose()
      return
    }

    await onDiscardDraft(draft.draftId)
    setExpanded(false)
  }

  React.useEffect(() => {
    setCcVisible(Boolean(draft?.cc?.length))
    setBccVisible(Boolean(draft?.bcc?.length))
  }, [draftKey, draft?.bcc?.length, draft?.cc?.length])

  if (!open) return <></>

  return (
    <TooltipProvider>
      <section
        role="dialog"
        aria-modal="false"
        aria-labelledby="mail-composer-title"
        className={cn(
          'app-no-drag fixed right-5 bottom-5 z-40 flex max-h-[calc(100vh-3rem)] w-[min(calc(100vw-2rem),38rem)] flex-col overflow-hidden rounded-xl border border-black/10 bg-background shadow-[0_24px_70px_rgb(0_0_0/0.28)] dark:border-white/12',
          expanded &&
            'top-8 bottom-8 w-[min(calc(100vw-2rem),56rem)] sm:right-8 sm:w-[min(calc(100vw-4rem),56rem)]'
        )}
      >
        <header className="flex h-9 shrink-0 items-center justify-between gap-3 border-b bg-muted/45 px-3 text-foreground">
          <div id="mail-composer-title" className="min-w-0 truncate text-xs font-semibold">
            {t('mail.composer.newMessage')}
          </div>
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={
                    expanded ? t('mail.composer.restoreWindow') : t('mail.composer.expandWindow')
                  }
                  onClick={() => setExpanded((value) => !value)}
                >
                  {expanded ? <Minimize2 /> : <Maximize2 />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {expanded ? t('mail.composer.restoreWindow') : t('mail.composer.expandWindow')}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t('mail.composer.closeComposer')}
                  disabled={pending}
                  onClick={() => {
                    void handleSaveAndClose()
                  }}
                >
                  <X />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {hasDraftContent(form) ? t('mail.composer.saveAndClose') : t('common.close')}
              </TooltipContent>
            </Tooltip>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-auto">
          <FieldGroup className="gap-0">
            <Field className={COMPOSER_ADDRESS_FIELD_CLASS} orientation="horizontal">
              <ComposerFieldLabel htmlFor="composer-account">{t('mail.composer.from')}</ComposerFieldLabel>
              <NativeSelect
                id="composer-account"
                size="sm"
                className="min-w-0 flex-1 [&_select]:border-0 [&_select]:bg-transparent [&_select]:shadow-none [&_select]:focus-visible:ring-0"
                value={form.accountId}
                disabled={pending}
                title={defaultAccount?.address}
                onChange={(event) => updateForm({ accountId: event.target.value })}
              >
                {sendAccounts.map((account) => (
                  <NativeSelectOption key={account.id} value={String(account.accountId)}>
                    {account.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field className={COMPOSER_ADDRESS_FIELD_CLASS} orientation="horizontal">
              <ComposerFieldLabel htmlFor="composer-to">{t('mail.composer.to')}</ComposerFieldLabel>
              <AddressInput
                id="composer-to"
                value={form.to}
                disabled={pending}
                placeholder="name@example.com"
                variant="ghost"
                onChange={(value) => updateForm({ to: value })}
              />
              <RecipientDisclosure
                ccVisible={ccVisible}
                bccVisible={bccVisible}
                disabled={pending}
                onShowCc={() => setCcVisible(true)}
                onShowBcc={() => setBccVisible(true)}
              />
            </Field>
            {ccVisible ? (
              <Field className={COMPOSER_ADDRESS_FIELD_CLASS} orientation="horizontal">
                <ComposerFieldLabel htmlFor="composer-cc">{t('mail.composer.cc')}</ComposerFieldLabel>
                <AddressInput
                  id="composer-cc"
                  value={form.cc}
                  disabled={pending}
                  variant="ghost"
                  onChange={(value) => updateForm({ cc: value })}
                />
              </Field>
            ) : null}
            {bccVisible ? (
              <Field className={COMPOSER_ADDRESS_FIELD_CLASS} orientation="horizontal">
                <ComposerFieldLabel htmlFor="composer-bcc">{t('mail.composer.bcc')}</ComposerFieldLabel>
                <AddressInput
                  id="composer-bcc"
                  value={form.bcc}
                  disabled={pending}
                  variant="ghost"
                  onChange={(value) => updateForm({ bcc: value })}
                />
              </Field>
            ) : null}
            <Field className="min-h-9 border-b px-3 py-1">
              <Input
                id="composer-subject"
                value={form.subject}
                disabled={pending}
                placeholder={t('mail.composer.subject')}
                className="h-7 border-0 px-0 py-0 shadow-none focus-visible:ring-0"
                onChange={(event) => updateForm({ subject: event.target.value })}
              />
            </Field>
            <MailBodyEditor
              draftKey={draftKey}
              bodyHtml={form.bodyHtml}
              bodyText={form.bodyText}
              disabled={pending}
              expanded={expanded}
              onChange={(value) => updateForm(value)}
            />
            {form.attachments.length > 0 ? (
              <div className="border-t bg-muted/15 px-3 py-2">
                <div className="mb-1.5 text-[11px] text-muted-foreground">
                  {t('mail.composer.attachmentsSummary', {
                    count: form.attachments.length,
                    size: formatAttachmentTotal(form.attachments)
                  })}
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {form.attachments.map((attachment) => (
                    <div
                      key={getAttachmentKey(attachment)}
                      className="flex min-h-8 items-center gap-2 rounded-md border bg-background px-2 text-xs"
                    >
                      <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">
                        {attachment.filename ?? attachment.filePath ?? t('mail.composer.attachmentFallback')}
                      </span>
                      <span className="shrink-0 text-muted-foreground">
                        {formatBytes(attachment.sizeBytes)}
                      </span>
                      {attachment.sourceAttachmentId ? (
                        <Checkbox
                          checked
                          disabled={pending}
                          aria-label={t('mail.composer.includeOriginalAttachment')}
                          onCheckedChange={(checked) => {
                            if (checked === false) removeAttachment(attachment)
                          }}
                        />
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          disabled={pending}
                          aria-label={t('mail.composer.removeAttachment')}
                          onClick={() => removeAttachment(attachment)}
                        >
                          <X />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {unselectedForwardAttachments.length > 0 ? (
              <div className="border-t bg-muted/15 px-3 py-2">
                <div className="mb-1.5 text-[11px] text-muted-foreground">
                  {t('mail.composer.originalAttachments')}
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {unselectedForwardAttachments.map((attachment) => (
                    <div
                      key={getAttachmentKey(attachment)}
                      className="flex min-h-8 items-center gap-2 rounded-md border bg-background px-2 text-xs"
                    >
                      <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">
                        {attachment.filename ?? t('mail.composer.attachmentFallback')}
                      </span>
                      <span className="shrink-0 text-muted-foreground">
                        {formatBytes(attachment.sizeBytes)}
                      </span>
                      <Checkbox
                        disabled={pending}
                        aria-label={t('mail.composer.includeOriginalAttachment')}
                        onCheckedChange={(checked) => {
                          if (checked !== true) return
                          updateForm((current) => ({
                            attachments: [...current.attachments, attachment]
                          }))
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {form.error ? (
              <FieldError className="border-t px-3 py-2">{form.error}</FieldError>
            ) : null}
          </FieldGroup>
        </div>

        <footer className="flex min-h-12 shrink-0 items-center justify-between gap-2 border-t bg-muted/15 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <Button
              className="h-8 min-w-20 shrink-0 rounded-lg"
              onClick={() => {
                void handleSubmit('send')
              }}
              disabled={pending || !draft}
            >
              <Send data-icon="inline-start" />
              {pending ? t('common.sending') : t('mail.composer.send')}
            </Button>
            <ComposerToolButton
              label={t('mail.composer.addAttachment')}
              disabled={pending}
              onClick={() => {
                void handleSelectAttachments()
              }}
            >
              <Paperclip />
            </ComposerToolButton>
          </div>
          <div className="flex items-center gap-1">
            <ComposerToolButton
              label={t('mail.composer.saveDraft')}
              disabled={pending || !draft}
              onClick={() => {
                void handleSubmit('draft')
              }}
            >
              <Save />
            </ComposerToolButton>
            <ComposerToolButton
              label={hasDraftContent(form) ? t('mail.composer.discardDraft') : t('common.close')}
              disabled={pending}
              onClick={() => {
                void handleDiscard()
              }}
            >
              <Trash2 />
            </ComposerToolButton>
          </div>
        </footer>
      </section>
    </TooltipProvider>
  )
}

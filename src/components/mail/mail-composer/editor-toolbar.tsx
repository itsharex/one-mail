import * as React from 'react'
import type { Editor } from '@tiptap/react'
import { AlignCenter, AlignLeft, AlignRight, Bold, Check, Italic, LinkIcon, List, ListOrdered, Redo, Strikethrough, Underline, Unlink, Undo } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@renderer/components/ui/input-group'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import { Separator } from '@renderer/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { useI18n } from '@renderer/lib/i18n'
import { escapeHtml } from './editor-utils'

type ComposerTextAlign = 'left' | 'center' | 'right'
type EditorSelectionRange = { from: number; to: number }
const COMPOSER_TEXT_ALIGNMENTS: ComposerTextAlign[] = ['left', 'center', 'right']

export function EditorToolbar({
  editor,
  disabled
}: {
  editor: Editor | null
  disabled: boolean
}): React.JSX.Element {
  const { t } = useI18n()
  const [, rerenderToolbar] = React.useReducer((count: number) => count + 1, 0)

  React.useEffect(() => {
    if (!editor) return

    editor.on('transaction', rerenderToolbar)
    editor.on('selectionUpdate', rerenderToolbar)
    editor.on('update', rerenderToolbar)

    return () => {
      editor.off('transaction', rerenderToolbar)
      editor.off('selectionUpdate', rerenderToolbar)
      editor.off('update', rerenderToolbar)
    }
  }, [editor])

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      <FormatButton
        label={t('mail.composer.undo')}
        disabled={disabled || !editor || !editor.can().undo()}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => editor?.chain().focus().undo().run()}
      >
        <Undo />
      </FormatButton>
      <FormatButton
        label={t('mail.composer.redo')}
        disabled={disabled || !editor || !editor.can().redo()}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => editor?.chain().focus().redo().run()}
      >
        <Redo />
      </FormatButton>
      <Separator orientation="vertical" className="mx-0.5 h-4" />
      <FormatButton
        label={t('mail.composer.bold')}
        active={editor?.isActive('bold')}
        disabled={disabled || !editor}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => editor?.chain().focus().toggleBold().run()}
      >
        <Bold />
      </FormatButton>
      <FormatButton
        label={t('mail.composer.italic')}
        active={editor?.isActive('italic')}
        disabled={disabled || !editor}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => editor?.chain().focus().toggleItalic().run()}
      >
        <Italic />
      </FormatButton>
      <FormatButton
        label={t('mail.composer.underline')}
        active={editor?.isActive('underline')}
        disabled={disabled || !editor}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => editor?.chain().focus().toggleUnderline().run()}
      >
        <Underline />
      </FormatButton>
      <FormatButton
        label={t('mail.composer.strikethrough')}
        active={editor?.isActive('strike')}
        disabled={disabled || !editor}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => editor?.chain().focus().toggleStrike().run()}
      >
        <Strikethrough />
      </FormatButton>
      <Separator orientation="vertical" className="mx-0.5 h-4" />
      <FormatButton
        label={t('mail.composer.bulletList')}
        active={editor?.isActive('bulletList')}
        disabled={disabled || !editor}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => editor?.chain().focus().toggleBulletList().run()}
      >
        <List />
      </FormatButton>
      <FormatButton
        label={t('mail.composer.orderedList')}
        active={editor?.isActive('orderedList')}
        disabled={disabled || !editor}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => editor?.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered />
      </FormatButton>
      <Separator orientation="vertical" className="mx-0.5 h-4" />
      <FormatButton
        label={t('mail.composer.alignLeft')}
        active={isTextAlignActive(editor, 'left')}
        disabled={disabled || !editor}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setComposerTextAlign(editor, 'left')}
      >
        <AlignLeft />
      </FormatButton>
      <FormatButton
        label={t('mail.composer.alignCenter')}
        active={isTextAlignActive(editor, 'center')}
        disabled={disabled || !editor}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setComposerTextAlign(editor, 'center')}
      >
        <AlignCenter />
      </FormatButton>
      <FormatButton
        label={t('mail.composer.alignRight')}
        active={isTextAlignActive(editor, 'right')}
        disabled={disabled || !editor}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setComposerTextAlign(editor, 'right')}
      >
        <AlignRight />
      </FormatButton>
      <Separator orientation="vertical" className="mx-0.5 h-4" />
      <LinkFormatButton editor={editor} disabled={disabled} />
    </div>
  )
}

function LinkFormatButton({
  editor,
  disabled
}: {
  editor: Editor | null
  disabled: boolean
}): React.JSX.Element {
  const { t } = useI18n()
  const [open, setOpen] = React.useState(false)
  const [url, setUrl] = React.useState('')
  const savedRangeRef = React.useRef<EditorSelectionRange | null>(null)
  const active = Boolean(editor?.isActive('link'))
  const unavailable = disabled || !editor

  function saveSelection(): void {
    if (!editor) return
    savedRangeRef.current = {
      from: editor.state.selection.from,
      to: editor.state.selection.to
    }
    setUrl((editor.getAttributes('link').href as string | undefined) ?? '')
  }

  function handleOpenChange(nextOpen: boolean): void {
    if (nextOpen) saveSelection()
    setOpen(nextOpen)
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    applyEditorLink(editor, url, savedRangeRef.current)
    setOpen(false)
  }

  function handleRemove(): void {
    removeEditorLink(editor, savedRangeRef.current)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant={active ? 'secondary' : 'ghost'}
          size="icon-xs"
          aria-label={t('mail.composer.link')}
          aria-pressed={active}
          disabled={unavailable}
          onMouseDown={(event) => {
            event.preventDefault()
            saveSelection()
          }}
        >
          <LinkIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <form onSubmit={handleSubmit}>
          <InputGroup>
            <InputGroupInput
              value={url}
              autoFocus
              aria-label={t('mail.composer.linkPrompt')}
              placeholder={t('mail.composer.linkPlaceholder')}
              onChange={(event) => setUrl(event.target.value)}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label={t('mail.composer.removeLink')}
                disabled={!active && !url.trim()}
                onClick={handleRemove}
              >
                <Unlink />
              </InputGroupButton>
              <InputGroupButton
                type="submit"
                size="icon-xs"
                variant="default"
                aria-label={t('mail.composer.applyLink')}
              >
                <Check />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </form>
      </PopoverContent>
    </Popover>
  )
}

function FormatButton({
  label,
  active,
  disabled,
  onMouseDown,
  onClick,
  children
}: {
  label: string
  active?: boolean
  disabled?: boolean
  onMouseDown?: (event: React.MouseEvent<HTMLButtonElement>) => void
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={active ? 'secondary' : 'ghost'}
          size="icon-xs"
          aria-label={label}
          aria-pressed={active}
          disabled={disabled}
          onMouseDown={onMouseDown}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function setComposerTextAlign(editor: Editor | null, textAlign: ComposerTextAlign): void {
  if (!editor) return

  editor
    .chain()
    .focus()
    .updateAttributes('paragraph', { textAlign })
    .updateAttributes('heading', { textAlign })
    .run()
}

function isTextAlignActive(editor: Editor | null, textAlign: ComposerTextAlign): boolean {
  if (!editor) return false
  return editor.isActive({ textAlign }) || (textAlign === 'left' && !hasTextAlign(editor))
}

function hasTextAlign(editor: Editor): boolean {
  return COMPOSER_TEXT_ALIGNMENTS.some((textAlign) => editor.isActive({ textAlign }))
}

function applyEditorLink(
  editor: Editor | null,
  value: string,
  range: EditorSelectionRange | null
): void {
  if (!editor) return

  restoreEditorSelection(editor, range)

  if (!value.trim()) {
    removeEditorLink(editor, range)
    return
  }

  const href = normalizeLinkUrl(value)

  if (editor.isActive('link')) {
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
    return
  }

  if (editor.state.selection.empty) {
    editor
      .chain()
      .focus()
      .insertContent(`<a href="${escapeHtmlAttribute(href)}">${escapeHtml(href)}</a>`)
      .unsetLink()
      .run()
    return
  }

  editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
}

function removeEditorLink(editor: Editor | null, range: EditorSelectionRange | null): void {
  if (!editor) return
  restoreEditorSelection(editor, range)
  editor.chain().focus().extendMarkRange('link').unsetLink().run()
}

function restoreEditorSelection(editor: Editor, range: EditorSelectionRange | null): void {
  if (!range) {
    editor.commands.focus()
    return
  }

  const docSize = editor.state.doc.content.size
  editor.commands.setTextSelection({
    from: Math.min(range.from, docSize),
    to: Math.min(range.to, docSize)
  })
  editor.commands.focus()
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, '&#96;')
}

function normalizeLinkUrl(value: string): string {
  const url = value.trim()
  return /^[a-z][a-z\d+.-]*:/i.test(url) ? url : `https://${url}`
}


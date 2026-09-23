import * as React from 'react'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import { EditorContent, Extension, useEditor, type Attribute } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { cn } from '@renderer/lib/utils'
import { useI18n } from '@renderer/lib/i18n'
import { EditorToolbar } from './editor-toolbar'
import { textToHtml } from './editor-utils'

const COMPOSER_TEXT_ALIGNMENTS = ['left', 'center', 'right'] as const

type ComposerTextAlign = (typeof COMPOSER_TEXT_ALIGNMENTS)[number]

const ComposerTextAlignExtension = Extension.create({
  name: 'composerTextAlign',
  addGlobalAttributes() {
    return [{ types: ['heading', 'paragraph'], attributes: { textAlign: createTextAlignAttribute() } }]
  }
})

export function MailBodyEditor({
  draftKey,
  bodyHtml,
  bodyText,
  disabled,
  expanded,
  onChange
}: {
  draftKey: string
  bodyHtml: string
  bodyText: string
  disabled: boolean
  expanded: boolean
  onChange: (patch: { bodyHtml: string; bodyText: string }) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const lastDraftKeyRef = React.useRef(draftKey)
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        link: false
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        defaultProtocol: 'https'
      }),
      ComposerTextAlignExtension,
      Placeholder.configure({
        placeholder: t('mail.composer.bodyPlaceholder')
      })
    ],
    content: bodyHtml || textToHtml(bodyText),
    editable: !disabled,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        id: 'composer-body',
        class: 'composer-body min-h-full px-4 py-3 outline-none break-words focus-visible:outline-none'
      }
    },
    onUpdate: ({ editor: currentEditor }) => {
      onChange({
        bodyHtml: currentEditor.getHTML(),
        bodyText: currentEditor.getText({ blockSeparator: '\n\n' })
      })
    }
  }, [t])

  React.useEffect(() => {
    editor?.setEditable(!disabled)
  }, [disabled, editor])

  React.useEffect(() => {
    if (!editor) return
    if (lastDraftKeyRef.current === draftKey) return
    lastDraftKeyRef.current = draftKey
    editor.commands.setContent(bodyHtml || textToHtml(bodyText), { emitUpdate: false })
  }, [bodyHtml, bodyText, draftKey, editor])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-9 shrink-0 items-center border-b bg-muted/20 px-2.5 py-1">
        <EditorToolbar editor={editor} disabled={disabled} />
      </div>
      <div
        className={cn('min-h-64 overflow-auto', expanded ? 'min-h-[28rem]' : 'max-h-[42vh]')}
        onClick={() => editor?.commands.focus()}
      >
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}

function createTextAlignAttribute(): Attribute {
  return {
    default: null,
    parseHTML: (element) => {
      const value = element.style.textAlign
      return isComposerTextAlign(value) ? value : null
    },
    renderHTML: (attributes) => {
      const value = attributes.textAlign
      if (!isComposerTextAlign(value)) return null
      return { style: `text-align: ${value}` }
    }
  }
}

function isComposerTextAlign(value: unknown): value is ComposerTextAlign {
  return typeof value === 'string' && COMPOSER_TEXT_ALIGNMENTS.includes(value as ComposerTextAlign)
}


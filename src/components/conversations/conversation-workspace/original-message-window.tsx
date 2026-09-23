import { useEffect, useState } from 'react'
import { emit, listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useI18n } from '@renderer/lib/i18n'
import { startWindowDrag } from '@renderer/lib/window-drag'
import type { ConversationMessage } from '@renderer/shared/conversations'
import { OriginalMessageView } from './original-message-view'

export function OriginalMessageWindow(): React.JSX.Element {
  const { locale } = useI18n()
  const text = (cn: string, en: string) => locale === 'zh-CN' ? cn : en
  const [message, setMessage] = useState<ConversationMessage | null>(null)

  useEffect(() => {
    void getCurrentWindow().setTitle(`${text('邮件原文', 'Original message')} - OneMail`)
  }, [locale])

  useEffect(() => {
    let active = true
    let stop: (() => void) | undefined
    void listen<ConversationMessage>('original/message', (event) => setMessage(event.payload))
      .then((unlisten) => {
        if (!active) { unlisten(); return }
        stop = unlisten
        return emit('original/ready')
      })
      .catch((reason) => console.warn('Failed to receive original message.', reason))
    return () => { active = false; stop?.() }
  }, [])

  return <main className="flex h-screen min-h-screen flex-col overflow-hidden bg-background text-foreground">
    <header className="app-titlebar app-drag-region flex h-12 shrink-0 items-center border-b bg-background" onMouseDown={startWindowDrag}>
      <h1 className="truncate text-sm font-semibold">{text('邮件原文', 'Original message')}</h1>
    </header>
    {message ? <OriginalMessageView key={message.id} message={message} text={text} /> :
      <p role="status" className="px-6 py-5 text-sm text-muted-foreground">{text('正在打开邮件…', 'Opening message…')}</p>}
  </main>
}

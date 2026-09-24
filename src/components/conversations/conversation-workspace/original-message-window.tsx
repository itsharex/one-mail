import { useEffect, useState } from 'react'
import { emit, listen } from '@tauri-apps/api/event'
import { useI18n } from '@renderer/lib/i18n'
import type { ConversationMessage } from '@renderer/shared/conversations'
import { OriginalMessageView } from './original-message-view'

export function OriginalMessageWindow(): React.JSX.Element {
  const { locale } = useI18n()
  const text = (cn: string, en: string) => locale === 'zh-CN' ? cn : en
  const [message, setMessage] = useState<ConversationMessage | null>(null)

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
    {message ? <OriginalMessageView key={message.id} message={message} text={text} /> :
      <p role="status" className="px-5 py-4 text-sm text-muted-foreground">{text('正在打开邮件…', 'Opening message…')}</p>}
  </main>
}

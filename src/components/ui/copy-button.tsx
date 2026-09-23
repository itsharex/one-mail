import { useEffect, useRef, useState } from 'react'
import { CheckIcon, CopyIcon } from 'lucide-react'
import { toast } from 'sonner'

import { useI18n } from '@renderer/lib/i18n'
import { Button } from './button'

type CopyButtonProps = Omit<React.ComponentProps<typeof Button>, 'children' | 'onClick'> & {
  value: string
  resetDelay?: number
}

export function CopyButton({ value, resetDelay = 2000, ...props }: CopyButtonProps): React.JSX.Element {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (resetTimer.current) clearTimeout(resetTimer.current)
  }, [])

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      toast.success(t('common.copied'))
      if (resetTimer.current) clearTimeout(resetTimer.current)
      resetTimer.current = setTimeout(() => setCopied(false), resetDelay)
    } catch {
      toast.error(t('common.copyFailed'))
    }
  }

  return (
    <Button
      {...props}
      type={props.type ?? 'button'}
      onClick={() => { void copy() }}
      aria-label={props['aria-label'] ?? t('common.copyValue', { value })}
    >
      {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
    </Button>
  )
}

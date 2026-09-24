import { exit } from '@tauri-apps/plugin-process'
import { Check, CircleAlert, Copy, RotateCcw } from 'lucide-react'
import * as React from 'react'
import { isRouteErrorResponse, useRouteError } from 'react-router'

import { Button } from '@renderer/components/ui/button'
import { normalizeLocale, translate } from '@renderer/lib/i18n'
import { startWindowDrag } from '@renderer/lib/window-drag'

export function AppErrorPage({ error, componentStack }: { error: unknown; componentStack?: string }): React.JSX.Element {
  const locale = normalizeLocale(document.documentElement.lang)
  const t = (key: Parameters<typeof translate>[1]): string => translate(locale, key)
  const [quitFailed, setQuitFailed] = React.useState(false)
  const [copyStatus, setCopyStatus] = React.useState<'idle' | 'copied' | 'failed'>('idle')
  const details = formatError(error)
  const diagnostic = componentStack?.trim()
    ? `${details}\n\n${t('error.componentStack')}:\n${componentStack.trim()}`
    : details

  async function copyDetails(): Promise<void> {
    try {
      await navigator.clipboard.writeText(diagnostic)
      setCopyStatus('copied')
    } catch (copyError) {
      console.error('Failed to copy OneMail error details.', copyError)
      setCopyStatus('failed')
    }
  }

  async function quit(): Promise<void> {
    try {
      await exit(0)
    } catch (error) {
      console.error('Failed to quit OneMail.', error)
      setQuitFailed(true)
    }
  }

  return (
    <main className="flex h-screen min-h-screen flex-col overflow-auto bg-background text-foreground">
      <header className="app-titlebar app-drag-region h-12 shrink-0" onMouseDown={startWindowDrag} />
      <div className="flex flex-1 items-center justify-center px-6 py-10">
        <div className="w-full max-w-2xl text-center">
          <div className="mx-auto mb-5 flex size-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
            <CircleAlert className="size-6" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-semibold">{t('error.title')}</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{t('error.description')}</p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            <Button type="button" onClick={() => window.location.reload()}>
              <RotateCcw aria-hidden="true" />
              {t('error.retry')}
            </Button>
            <Button type="button" variant="outline" onClick={() => void quit()}>
              {t('error.quit')}
            </Button>
          </div>
          {quitFailed && <p role="alert" className="mt-4 text-sm text-destructive">{t('error.quitFailed')}</p>}
          <section className="mt-8 text-left" aria-label={t('error.details')}>
            <div className="mb-2 flex items-center justify-between gap-3">
              <h2 className="text-sm font-medium">{t('error.details')}</h2>
              <Button type="button" size="sm" variant="outline" onClick={() => void copyDetails()}>
                {copyStatus === 'copied' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                {copyStatus === 'copied' ? t('common.copied') : t('error.copyDetails')}
              </Button>
            </div>
            <pre className="max-h-[40vh] overflow-auto rounded-lg border bg-muted/50 p-3 font-mono text-xs leading-5 whitespace-pre-wrap break-all select-text">{diagnostic}</pre>
            {copyStatus === 'failed' && <p role="alert" className="mt-2 text-sm text-destructive">{t('common.copyFailed')}</p>}
          </section>
        </div>
      </div>
    </main>
  )
}

export function RouteErrorPage(): React.JSX.Element {
  const error = useRouteError()

  React.useEffect(() => {
    console.error('OneMail route failed to render.', error)
  }, [error])

  return <AppErrorPage error={error} />
}

type AppErrorBoundaryState = { failed: boolean; error?: unknown; componentStack?: string }

export class AppErrorBoundary extends React.Component<React.PropsWithChildren, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    return { failed: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('OneMail failed to render.', error, info.componentStack)
    this.setState({ componentStack: info.componentStack ?? undefined })
  }

  render(): React.ReactNode {
    return this.state.failed
      ? <AppErrorPage error={this.state.error} componentStack={this.state.componentStack} />
      : this.props.children
  }
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.stack || `${error.name}: ${error.message}`
  if (isRouteErrorResponse(error)) {
    const status = `${error.status} ${error.statusText}`.trim()
    return error.data == null ? status : `${status}\n${formatError(error.data)}`
  }
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error, null, 2) ?? String(error)
  } catch {
    return String(error)
  }
}

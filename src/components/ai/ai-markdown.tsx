import type * as React from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { openExternalUrl } from '@renderer/lib/api'

export function AiMarkdown({ children }: { children: string }): React.JSX.Element {
  return (
    <div className="min-w-0 break-words text-[13px] leading-[1.6] text-foreground [&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_h1]:mb-2 [&_h1]:text-sm [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:mb-1.5 [&_h3]:text-[13px] [&_h3]:font-semibold [&_li]:pl-0.5 [&_li_p]:my-0 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5 [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-2.5 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_table]:my-2 [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_table]:text-left [&_td]:border-b [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_th]:border-b [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:font-semibold [&_ul]:my-2 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          img: () => null,
          a: ({ href, children: label }) => {
            const url = safeExternalUrl(href)
            return url ? (
              <button type="button" className="text-primary underline underline-offset-2 hover:opacity-75" title={url} onClick={() => { void openExternalUrl(url) }}>{label}</button>
            ) : <span>{label}</span>
          }
        }}
      >
        {children}
      </Markdown>
    </div>
  )
}

function safeExternalUrl(value?: string): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

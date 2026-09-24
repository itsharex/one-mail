import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { AiMarkdown } from './ai-markdown'

describe('AiMarkdown', () => {
  it('renders a nested mail summary as formatted text without loading images or HTML', () => {
    const html = renderToStaticMarkup(
      <AiMarkdown>{`关键信息摘要：\n\n- **订单**：已发货\n  - 物流：Amazon Logistics\n\n![tracking](https://example.test/pixel.png)\n<script>alert(1)</script>`}</AiMarkdown>
    )

    expect(html).toContain('<ul')
    expect(html).toContain('<li')
    expect(html).toContain('<strong>订单</strong>')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<script>')
  })
})

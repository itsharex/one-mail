import { describe, expect, it } from 'vitest'

import { compactMailBodyText } from './mail-text'

describe('mail body whitespace', () => {
  it('collapses repeated blank lines including whitespace and invisible spacer lines', () => {
    expect(compactMailBodyText('\n\n正文\r\n \t\r\n\u00a0\r\n\u200b\r\n\r\n下一段\n\n'))
      .toBe('正文\n\n下一段')
  })

  it('preserves single line breaks, paragraph breaks and indentation', () => {
    const text = '  第一行\n    缩进内容\n\n下一段\n> 引用内容'
    expect(compactMailBodyText(text)).toBe(text)
  })
})

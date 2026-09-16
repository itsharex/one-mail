import { describe, expect, it } from 'vitest'

import { compactMailBodyText, normalizeMailBodyText } from './mail-text'

describe('mail body whitespace', () => {
  it('collapses repeated blank lines including whitespace and invisible spacer lines', () => {
    expect(compactMailBodyText('\n\n正文\r\n \t\r\n\u00a0\r\n\u200b\r\n\r\n下一段\n\n'))
      .toBe('正文\n\n下一段')
  })

  it('preserves single line breaks, paragraph breaks and indentation', () => {
    const text = '  第一行\n    缩进内容\n\n下一段\n> 引用内容'
    expect(compactMailBodyText(text)).toBe(text)
  })

  it('normalizes cached plain text bodies without joining words or lines', () => {
    expect(normalizeMailBodyText('Hello world  \rLine two\r\r\rLast line'))
      .toBe('Hello world\nLine two\n\nLast line')
  })

  it('treats spacer-only bodies as empty and remains stable on repeated normalization', () => {
    expect(normalizeMailBodyText('\n \t\n\u200b\n')).toBeUndefined()
    const text = compactMailBodyText('正文\n\n\n\n下一段')
    expect(compactMailBodyText(text)).toBe(text)
  })
})

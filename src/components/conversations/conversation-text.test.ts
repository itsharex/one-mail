import { describe, expect, it } from 'vitest'
import { conversationLinkUrl, conversationTextParts } from './conversation-text'

describe('conversation links', () => {
  it('keeps invoice URL paths and query parameters intact', () => {
    const url = 'https://example.com/invoice/a_B-c.pt?file=1&token=a%2Bb'
    expect(conversationTextParts(`发票链接：${url}。`)).toEqual([
      { text: '发票链接：' }, { text: url, href: url }, { text: '。' }
    ])
  })

  it('separates surrounding punctuation without stripping balanced URL parentheses', () => {
    const url = 'https://example.com/page_(one)'
    expect(conversationTextParts(`See (${url}). Next: https://example.org/page!`)).toEqual([
      { text: 'See (' }, { text: url, href: url }, { text: '). Next: ' },
      { text: 'https://example.org/page', href: 'https://example.org/page' }, { text: '!' }
    ])
  })

  it('keeps distinct destinations for links with the same label', () => {
    const links = [{ text: '下载', href: 'https://example.com/one' }, { text: '下载', href: 'https://example.com/two' }]
    expect(conversationTextParts('\uE0000\uE001 / \uE0001\uE001', links)).toEqual([links[0], { text: ' / ' }, links[1]])
  })

  it('allows only web destinations supported by the desktop opener', () => {
    expect(conversationLinkUrl('//example.com/invoice')).toBe('https://example.com/invoice')
    for (const value of ['javascript:alert(1)', 'data:text/html,test', 'file:///tmp/test', '/relative']) {
      expect(conversationLinkUrl(value)).toBeUndefined()
    }
  })
})

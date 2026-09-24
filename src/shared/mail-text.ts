export function compactMailBodyText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+$/gm, '')
    .replace(/^[\t \u00a0\u200b\u200c\u200d\u2060\ufeff]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\s+$/g, '')
}

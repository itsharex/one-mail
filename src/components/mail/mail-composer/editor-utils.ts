export function textToHtml(value: string): string {
  const normalized = value.replace(/\r?\n/g, '\n')
  if (!normalized.trim()) return ''
  return normalized
    .split(/\n{2,}/)
    .map((paragraph) => {
      const lines = paragraph.split('\n').map(escapeHtml).join('<br>')
      return `<p>${lines || '<br>'}</p>`
    })
    .join('')
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}


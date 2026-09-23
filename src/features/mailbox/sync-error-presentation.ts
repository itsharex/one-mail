import type { TranslationKey } from '@renderer/lib/i18n'

type Translate = (key: TranslationKey, values?: Record<string, string | number>) => string

export function getSyncErrorPresentation(message: string, t: Translate): { reason: string; suggestion: string } {
  if (/AADSTS70000|grant is expired|must sign in again|invalid_grant|refresh token 不存在/i.test(message)) {
    return { reason: t('sync.errorAuthorizationExpired'), suggestion: t('sync.suggestionReauthorize') }
  }
  if (/凭据不存在|凭据格式无效|凭据解密失败|重新保存密码|invalid credentials|authentication failed/i.test(message)) {
    return { reason: t('sync.errorCredentials'), suggestion: t('sync.suggestionCredentials') }
  }
  if (/timed? out|connection refused|connection closed|network|网络|连接超时/i.test(message)) {
    return { reason: t('sync.errorConnection'), suggestion: t('sync.suggestionConnection') }
  }

  const reason = message
    .replace(/\b(?:Trace ID|Correlation ID|Timestamp)\s*:[\s\S]*$/i, '')
    .replace(/^.*?(?:同步失败|sync failed)\s*[:：]\s*/i, '')
    .trim()
  return {
    reason: reason.length > 180 ? `${reason.slice(0, 180)}…` : reason || t('sync.error'),
    suggestion: t('sync.suggestionGeneric')
  }
}

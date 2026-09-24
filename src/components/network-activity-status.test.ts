import { describe, expect, it } from 'vitest'

import { formatNetworkDuration } from './network-activity-status'

describe('network request duration', () => {
  it('uses milliseconds, seconds, then minutes at the unit boundaries', () => {
    expect(formatNetworkDuration(999, 'zh-CN')).toBe('999 ms')
    expect(formatNetworkDuration(1000, 'zh-CN')).toBe('1.0 s')
    expect(formatNetworkDuration(60_000, 'zh-CN')).toBe('1 分 0 秒')
    expect(formatNetworkDuration(61_200, 'en-US')).toBe('1 min 1 s')
    expect(formatNetworkDuration(3_661_000, 'zh-CN')).toBe('1 小时 1 分')
  })
})

import { memo, useMemo } from 'react'
import NiceAvatar, { genConfig } from 'react-nice-avatar'

import { cn } from '@renderer/lib/utils'

export const DefaultAvatar = memo(function DefaultAvatar({ seed, className }: { seed: string; className?: string }) {
  const normalizedSeed = seed.trim().toLowerCase() || 'onemail'
  const config = useMemo(() => genConfig(normalizedSeed), [normalizedSeed])

  return <div aria-hidden="true" className={cn('size-10 shrink-0 overflow-hidden rounded-full', className)}>
    <NiceAvatar className="size-full" shape="square" {...config} />
  </div>
})

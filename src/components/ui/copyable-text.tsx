import { cn } from '@renderer/lib/utils'
import { CopyButton } from './copy-button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip'

export function CopyableText({ value, className }: { value: string; className?: string }): React.JSX.Element {
  return (
    <TooltipProvider>
      <div className={cn('group/copy app-no-drag flex min-w-0 items-center gap-1', className)}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="min-w-0 flex-1 truncate">{value}</span>
          </TooltipTrigger>
          <TooltipContent className="max-w-80 break-all">{value}</TooltipContent>
        </Tooltip>
        <CopyButton
          value={value}
          variant="ghost"
          size="icon-xs"
          className="size-5 shrink-0 opacity-0 transition-opacity group-hover/copy:opacity-100 group-focus-within/copy:opacity-100 [@media(hover:none)]:opacity-100"
        />
      </div>
    </TooltipProvider>
  )
}

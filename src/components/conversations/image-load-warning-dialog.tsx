import { Button } from '@renderer/components/ui/button'
import { ResponsiveDialog } from '@renderer/components/responsive-dialog'
import { openExternalUrl } from '@renderer/lib/api'
import { toast } from 'sonner'

const IMAGE_PRIVACY_ARTICLE_URL = 'https://huzhihui.com/blog/click-load-images-ip-leak-email-tracking'

export function ImageLoadWarningDialog({ open, onOpenChange, onConfirm, text }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  text: (cn: string, en: string) => string
}) {
  return <ResponsiveDialog
    open={open}
    onOpenChange={onOpenChange}
    title={text('加载图片前请注意', 'Before loading images')}
    description={text('远程图片可能用于追踪邮件阅读行为，请仅在信任发件人时加载。', 'Remote images may track email reading activity. Only load them if you trust the sender.')}
    contentClassName="md:max-w-sm"
    headerClassName="text-left"
    bodyClassName="space-y-3 px-4 text-sm leading-6 text-muted-foreground md:px-0"
    footer={<>
      <Button variant="outline" onClick={() => onOpenChange(false)}>{text('取消', 'Cancel')}</Button>
      <Button onClick={() => { onConfirm(); onOpenChange(false) }}>{text('仍然加载', 'Load anyway')}</Button>
    </>}
  >
    <p>{text('加载图片会向发件人或图片服务商发起网络请求，可能暴露你的出口 IP、访问时间及部分设备信息。即使是不可见的追踪像素，也可能让对方知道你打开了邮件。', 'Loading images sends requests to the sender or image provider, potentially revealing your public IP address, access time, and some device information. Even invisible tracking pixels may reveal that you opened the email.')}</p>
    <p>{text('本次确认仅对当前邮件生效，将显示包含图片的原始排版。', 'This confirmation applies only to this message and displays its original layout with images.')}</p>
    <a href={IMAGE_PRIVACY_ARTICLE_URL} className="text-primary underline underline-offset-4" onClick={(event) => {
      event.preventDefault()
      void openExternalUrl(IMAGE_PRIVACY_ARTICLE_URL).catch(() => toast.error(text('无法打开链接，请稍后重试', 'Could not open the link. Try again.')))
    }}>{text('了解详情：加载邮件图片为何可能泄露 IP', 'Learn more: how loading email images can expose your IP')}</a>
  </ResponsiveDialog>
}

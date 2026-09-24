

export type AppSettings = {
  bodyDisplayMode: 'text' | 'html'
  syncIntervalMinutes: number
  syncWindowDays: number
  logRetentionDays: number
  openAtLogin: boolean
  externalImagesBlocked: boolean
  locale: string
}

export type SettingsUpdateInput = Partial<AppSettings>

export type AiSettings = {
  baseUrl: string
  model: string
  apiKeyConfigured: boolean
  verified: boolean
  verifiedAt?: string
}

export type AiSettingsInput = {
  baseUrl: string
  model: string
  apiKey?: string
}

export type AiChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type AiChatInput = {
  messageId?: number
  messages: AiChatMessage[]
}

export type AiChatResult = {
  message: AiChatMessage
  model: string
  contextTruncated?: boolean
}

export type BackupSyncProvider = 'none' | 'webdav' | 's3'

export type BackupSyncSettings =
  | {
      provider: 'none'
    }
  | {
      provider: 'webdav'
      remoteUrl: string
      username?: string
      password?: string
      passwordConfigured?: boolean
    }
  | {
      provider: 's3'
      endpoint?: string
      region: string
      bucket: string
      key: string
      accessKeyId: string
      secretAccessKey?: string
      secretAccessKeyConfigured?: boolean
    }

export type BackupSyncTransferResult = {
  provider: Exclude<BackupSyncProvider, 'none'>
  remotePath: string
  fileName?: string
  exportedAt?: number
  transferredAt: string
}

export type BackupSyncTestResult = {
  provider: Exclude<BackupSyncProvider, 'none'>
  remotePath: string
  testedAt: string
}

export type BackupImportSource = 'local' | Exclude<BackupSyncProvider, 'none'>

export type BackupImportStage =
  | 'selecting_file'
  | 'reading_file'
  | 'downloading_remote'
  | 'validating_backup'
  | 'restoring_database'
  | 'loading_stats'
  | 'completed'

export type BackupImportProgress = {
  operationId: string
  source: BackupImportSource
  stage: BackupImportStage
  percent: number
  filePath?: string
  remotePath?: string
  sourceName?: string
}

export type BackupSyncDownloadResult = BackupImportResult & {
  provider?: Exclude<BackupSyncProvider, 'none'>
  remotePath?: string
}

export type BackupImportResult = {
  imported: boolean
  filePath?: string
  importedAt?: string
  exportedAt?: number
  accountCount?: number
  messageCount?: number
}

export type SystemInfo = {
  platform: NodeJS.Platform
  appVersion: string
  databasePath: string
  userDataPath: string
}

export type AppTheme = 'light' | 'dark'

export type AppUpdateProgress = {
  percent: number
  transferredBytes: number
  totalBytes: number
  bytesPerSecond: number
}

export type AppUpdateStatus = {
  state:
    | 'idle'
    | 'checking'
    | 'available'
    | 'downloading'
    | 'downloaded'
    | 'installing'
    | 'not_available'
    | 'unsupported'
    | 'cancelled'
    | 'error'
  currentVersion: string
  latestVersion?: string
  releaseUrl?: string
  message: string
  progress?: AppUpdateProgress
  updatedAt: string
}

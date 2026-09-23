

export type AccountStatus =
  | 'active'
  | 'disabled'
  | 'syncing'
  | 'auth_error'
  | 'sync_error'
  | 'network_error'
export type AccountConnectionStatus = 'connected' | 'renewing' | 'reauthorize'
export type AuthType = 'oauth2' | 'app_password' | 'password' | 'bridge' | 'manual'
export type ImapSecurity = 'ssl_tls' | 'starttls' | 'none'
export type SmtpSecurity = 'ssl_tls' | 'starttls' | 'none'
export type CredentialState = 'pending' | 'stored' | 'invalid' | 'expired' | 'revoked'
export type OAuthAuthorizationMode = 'system_browser' | 'copy_link'
export type SyncMode = 'initial' | 'refresh'

export type ImapFolder = {
  path: string
  name: string
  delimiter?: string | null
  role: string
  attributes: string[]
  isSelectable: boolean
}

export type ImapSyncFolder = ImapFolder & {
  syncEnabled: boolean
}

export type ImapFolderDiscoveryInput = {
  email: string
  password: string
  imapHost: string
  imapPort: number
  imapSecurity: ImapSecurity
}

export type MailAccount = {
  accountId: number
  providerKey: string
  email: string
  displayName?: string
  accountLabel?: string
  authType: AuthType
  imapHost: string
  imapPort: number
  imapSecurity: ImapSecurity
  smtpHost?: string
  smtpPort?: number
  smtpSecurity?: SmtpSecurity
  smtpAuthType?: AuthType
  smtpEnabled: boolean
  syncEnabled: boolean
  credentialState: CredentialState
  status: AccountStatus
  connectionStatus: AccountConnectionStatus
  lastSyncAt?: string
  lastError?: string
}

export type AccountCreateInput = {
  providerKey: string
  email?: string
  password?: string
  accountLabel?: string
  authType: AuthType
  oauthAuthorizationMode?: OAuthAuthorizationMode
  imapHost: string
  imapPort: number
  imapSecurity: ImapSecurity
  smtpHost?: string
  smtpPort?: number
  smtpSecurity?: SmtpSecurity
  smtpAuthType?: AuthType
  smtpEnabled?: boolean
  syncFolders?: ImapSyncFolder[]
}

export type AccountCreatedEvent = {
  account: MailAccount
  requestedSync: boolean
}

export type AccountUpdateInput = Partial<Omit<AccountCreateInput, 'email' | 'password'>> & {
  accountId: number
  displayName?: string
  password?: string
  syncEnabled?: boolean
}

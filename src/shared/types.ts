export type ConnectionType = 's3' | 'ssh'

interface EntryBase {
  id: string
  name: string
  parentId?: string | null
  _encrypted?: boolean
  // Solo en tiempo de ejecución: algún secreto guardado no se pudo descifrar (nunca se persiste)
  credentialsUnavailable?: boolean
}

export interface FolderEntry extends EntryBase {
  isFolder: true
}

export interface S3Connection extends EntryBase {
  type: 's3'
  isFolder?: false
  endpoint: string
  accessKeyId: string
  secretAccessKey: string
  bucket?: string
  region?: string
}

export type SshAuthMethod = 'password' | 'privateKey'

export interface SshConnection extends EntryBase {
  type: 'ssh'
  isFolder?: false
  host: string
  port: number
  username: string
  authMethod: SshAuthMethod
  password?: string
  privateKeyPath?: string
  passphrase?: string
  initialPath?: string
}

export type Connection = S3Connection | SshConnection
export type ConnectionEntry = Connection | FolderEntry

// Conexión sin id (formulario de alta o edición)
export type ConnectionDraft = Omit<S3Connection, 'id'> | Omit<SshConnection, 'id'>

// Ubicación actual del panel remoto, para subir desde el panel local
export type RemoteLocation = { kind: 's3'; bucket: string; prefix: string } | { kind: 'sftp'; path: string }

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

// Cuenta en la nube (require-account-in-app)
export type SessionState =
  | { state: 'signed-out'; expired?: boolean }
  | { state: 'signed-in'; email: string }
  | { state: 'unreachable' }

// Resultado de las operaciones de cuenta: `code` es el código estable de la API
// (invalid_credentials, email_taken…) o network_error si no se pudo contactar con ella
export type CloudResult = { ok: true } | { ok: false; code: string }
export type SignInResult = { ok: true; email: string } | { ok: false; code: string }

export interface MigrationOffer {
  count: number // conexiones (sin contar carpetas) legibles en connections.json
  recoveredFile: string | null // copia del fichero dañado, si hubo que apartarlo
}

export interface ConnectionsChangedEvent {
  conflict: boolean // un guardado se rechazó porque otro equipo guardó antes
}

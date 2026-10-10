import { Client, ConnectConfig, FileEntryWithStats, SFTPWrapper, Stats } from 'ssh2'
import { createHash } from 'crypto'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { SshConnection } from '../shared/types'
import { moveTempFile, ProgressCallback } from './s3'

const posix = path.posix

export type SshErrorCode =
  | 'SSH_AUTH_FAILED'
  | 'SSH_UNREACHABLE'
  | 'SSH_TIMEOUT'
  | 'SSH_CONNECTION_LOST'
  | 'SSH_KEY_UNREADABLE'
  | 'SSH_KEY_UNSUPPORTED'
  | 'SSH_KEY_PASSPHRASE'
  | 'SFTP_PERMISSION_DENIED'
  | 'SFTP_NOT_FOUND'
  | 'SSH_ERROR'

// El mensaje empieza por el código para que el renderer lo reconozca tras el envoltorio de IPC
export class SshError extends Error {
  constructor(
    readonly code: SshErrorCode,
    detail: string
  ) {
    super(`${code}: ${detail}`)
  }
}

const NETWORK_ERRORS = ['ENOTFOUND', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN']
const SFTP_STATUS_NO_SUCH_FILE = 2
const SFTP_STATUS_PERMISSION_DENIED = 3

function toSshError(err: unknown): SshError {
  if (err instanceof SshError) return err
  const e = err as { message?: string; level?: string; code?: string | number }
  const message = e?.message ?? String(err)
  if (e?.level === 'client-authentication') return new SshError('SSH_AUTH_FAILED', message)
  if (e?.level === 'client-timeout' || /timed out while waiting for handshake/i.test(message)) {
    return new SshError('SSH_TIMEOUT', message)
  }
  if (typeof e?.code === 'string' && NETWORK_ERRORS.includes(e.code)) {
    return new SshError('SSH_UNREACHABLE', message)
  }
  if (
    e?.code === 'ECONNRESET' ||
    /no response from server|not connected|keepalive timeout|channel open failure/i.test(message)
  ) {
    return new SshError('SSH_CONNECTION_LOST', message)
  }
  if (e?.code === SFTP_STATUS_PERMISSION_DENIED) return new SshError('SFTP_PERMISSION_DENIED', message)
  if (e?.code === SFTP_STATUS_NO_SUCH_FILE) return new SshError('SFTP_NOT_FOUND', message)
  return new SshError('SSH_ERROR', message)
}

function expandHome(p: string): string {
  return p === '~' || p.startsWith('~/') || p.startsWith('~\\') ? path.join(os.homedir(), p.slice(1)) : p
}

// ---------------------------------------------------------------------------
// Pool: una conexión SSH por id de conexión, reutilizada por SFTP (y por la terminal)
// ---------------------------------------------------------------------------

interface PoolEntry {
  key: string
  client: Client
  ready: Promise<Client>
  sftp?: Promise<SFTPWrapper>
}

const pool = new Map<string, PoolEntry>()

// Huella de los parámetros: si el usuario edita la conexión, se abre una nueva
function fingerprint(conn: SshConnection): string {
  const { host, port, username, authMethod, privateKeyPath, password, passphrase } = conn
  return createHash('sha256')
    .update(JSON.stringify([host, port, username, authMethod, privateKeyPath, password, passphrase]))
    .digest('hex')
}

async function buildConfig(conn: SshConnection): Promise<ConnectConfig> {
  const config: ConnectConfig = {
    host: conn.host,
    port: conn.port,
    username: conn.username,
    readyTimeout: 15000,
    keepaliveInterval: 15000
  }
  if (conn.authMethod === 'password') {
    config.password = conn.password ?? ''
    config.tryKeyboard = true
    return config
  }
  const keyPath = expandHome(conn.privateKeyPath ?? '')
  let key: Buffer
  try {
    key = await fs.readFile(keyPath)
  } catch (err) {
    throw new SshError('SSH_KEY_UNREADABLE', `${keyPath}: ${(err as Error).message}`)
  }
  if (key.toString('utf8', 0, 32).startsWith('PuTTY-User-Key-File-3')) {
    throw new SshError('SSH_KEY_UNSUPPORTED', 'PuTTY PPK v3 keys are not supported; convert the key with PuTTYgen')
  }
  config.privateKey = key
  if (conn.passphrase) config.passphrase = conn.passphrase
  return config
}

function dropEntry(id: string, entry: PoolEntry): void {
  if (pool.get(id) === entry) pool.delete(id)
}

export async function getClient(conn: SshConnection): Promise<Client> {
  const key = fingerprint(conn)
  const existing = pool.get(conn.id)
  if (existing?.key === key) return existing.ready
  if (existing) {
    pool.delete(conn.id)
    existing.client.end()
  }

  const config = await buildConfig(conn)
  const client = new Client()
  const entry = { key, client } as PoolEntry
  entry.ready = new Promise<Client>((resolve, reject) => {
    client.once('ready', () => resolve(client))
    client.once('error', (err) => reject(toSshError(err)))
    client.once('close', () => reject(new SshError('SSH_CONNECTION_LOST', 'Connection closed')))
  })
  client.on('keyboard-interactive', (_name, _instructions, _lang, prompts, finish) => {
    finish(prompts.map(() => conn.password ?? ''))
  })
  client.on('error', () => dropEntry(conn.id, entry))
  client.on('close', () => dropEntry(conn.id, entry))
  pool.set(conn.id, entry)

  try {
    client.connect(config)
  } catch (err) {
    // ssh2 valida la clave al conectar y lanza de forma síncrona si no puede leerla
    dropEntry(conn.id, entry)
    const message = (err as Error).message
    entry.ready.catch(() => undefined)
    if (/passphrase/i.test(message)) throw new SshError('SSH_KEY_PASSPHRASE', message)
    throw new SshError('SSH_KEY_UNSUPPORTED', message)
  }
  try {
    return await entry.ready
  } catch (err) {
    dropEntry(conn.id, entry)
    throw err
  }
}

export function closeAllSsh(): void {
  for (const entry of pool.values()) entry.client.end()
  pool.clear()
}

// ---------------------------------------------------------------------------
// SFTP
// ---------------------------------------------------------------------------

async function getSftp(conn: SshConnection): Promise<SFTPWrapper> {
  const client = await getClient(conn)
  const entry = pool.get(conn.id)
  if (!entry) throw new SshError('SSH_CONNECTION_LOST', 'Connection closed')
  if (!entry.sftp) {
    const sftp = new Promise<SFTPWrapper>((resolve, reject) => {
      client.sftp((err, s) => {
        if (err) return reject(toSshError(err))
        s.on('close', () => {
          if (entry.sftp === sftp) entry.sftp = undefined
        })
        resolve(s)
      })
    })
    entry.sftp = sftp
    sftp.catch(() => {
      if (entry.sftp === sftp) entry.sftp = undefined
    })
  }
  return entry.sftp
}

function call<T>(fn: (cb: (err: Error | undefined | null, result?: T) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    fn((err, result) => (err ? reject(toSshError(err)) : resolve(result as T)))
  })
}

export async function sftpHome(conn: SshConnection): Promise<string> {
  const sftp = await getSftp(conn)
  const home = await call<string>((cb) => sftp.realpath('.', cb))
  const initial = conn.initialPath?.trim()
  if (!initial) return home
  const target = initial === '~' || initial.startsWith('~/') ? posix.join(home, initial.slice(1)) : initial
  return call<string>((cb) => sftp.realpath(target, cb))
}

export interface RemoteFile {
  name: string
  path: string
  size: number
  lastModified: string
}

export async function sftpListDir(
  conn: SshConnection,
  dirPath: string
): Promise<{ currentPath: string; folders: string[]; files: RemoteFile[] }> {
  const sftp = await getSftp(conn)
  const entries = await call<FileEntryWithStats[]>((cb) => sftp.readdir(dirPath, cb))
  const folders: string[] = []
  const files: RemoteFile[] = []

  for (const entry of entries) {
    if (entry.filename === '.' || entry.filename === '..') continue
    const fullPath = posix.join(dirPath, entry.filename)
    let attrs: Stats = entry.attrs
    if (attrs.isSymbolicLink()) {
      // Un enlace se muestra como su destino; si está roto, como archivo
      attrs = await call<Stats>((cb) => sftp.stat(fullPath, cb)).catch(() => entry.attrs)
    }
    if (attrs.isDirectory()) {
      folders.push(entry.filename)
    } else {
      files.push({
        name: entry.filename,
        path: fullPath,
        size: attrs.size,
        lastModified: new Date(attrs.mtime * 1000).toISOString()
      })
    }
  }

  folders.sort((a, b) => a.localeCompare(b))
  files.sort((a, b) => a.name.localeCompare(b.name))
  return { currentPath: dirPath, folders, files }
}

export async function sftpCreateDir(conn: SshConnection, dirPath: string, name: string): Promise<string> {
  const sftp = await getSftp(conn)
  const fullPath = posix.join(dirPath, name)
  await call<void>((cb) => sftp.mkdir(fullPath, cb))
  return fullPath
}

async function removeTree(sftp: SFTPWrapper, dirPath: string): Promise<void> {
  const entries = await call<FileEntryWithStats[]>((cb) => sftp.readdir(dirPath, cb))
  for (const entry of entries) {
    if (entry.filename === '.' || entry.filename === '..') continue
    const child = posix.join(dirPath, entry.filename)
    // Los atributos de readdir no siguen enlaces: un enlace a carpeta se borra como enlace
    if (entry.attrs.isDirectory()) await removeTree(sftp, child)
    else await call<void>((cb) => sftp.unlink(child, cb))
  }
  await call<void>((cb) => sftp.rmdir(dirPath, cb))
}

export async function sftpDelete(conn: SshConnection, itemPath: string): Promise<void> {
  const sftp = await getSftp(conn)
  const stats = await call<Stats>((cb) => sftp.lstat(itemPath, cb))
  if (stats.isDirectory()) await removeTree(sftp, itemPath)
  else await call<void>((cb) => sftp.unlink(itemPath, cb))
}

// fastPut/fastGet no llaman a su callback si la conexión se cae a mitad: se escucha también el
// cierre del canal SFTP y de la conexión para que la transferencia termine siempre
async function runTransfer(
  conn: SshConnection,
  run: (sftp: SFTPWrapper, done: (err?: Error | null) => void) => void
): Promise<void> {
  const sftp = await getSftp(conn)
  const client = pool.get(conn.id)?.client
  return new Promise<void>((resolve, reject) => {
    let settled = false
    const onClose = (): void => finish(new SshError('SSH_CONNECTION_LOST', 'Connection closed during transfer'))
    const finish = (err?: Error | null): void => {
      if (settled) return
      settled = true
      sftp.removeListener('close', onClose)
      client?.removeListener('close', onClose)
      if (err) reject(toSshError(err))
      else resolve()
    }
    sftp.once('close', onClose)
    client?.once('close', onClose)
    run(sftp, finish)
  })
}

export async function sftpUpload(
  conn: SshConnection,
  localPath: string,
  remotePath: string,
  onProgress?: ProgressCallback
): Promise<void> {
  await runTransfer(conn, (sftp, done) =>
    sftp.fastPut(localPath, remotePath, { step: (transferred, _chunk, total) => onProgress?.(transferred, total) }, done)
  )
}

export async function sftpDownload(
  conn: SshConnection,
  remotePath: string,
  localDestPath: string,
  onProgress?: ProgressCallback
): Promise<void> {
  const partialDestPath = `${localDestPath}.part`
  try {
    await fs.mkdir(path.dirname(localDestPath), { recursive: true })
    await runTransfer(conn, (sftp, done) =>
      sftp.fastGet(remotePath, partialDestPath, { step: (transferred, _chunk, total) => onProgress?.(transferred, total) }, done)
    )
    await moveTempFile(partialDestPath, localDestPath)
  } catch (err) {
    await fs.rm(partialDestPath, { force: true }).catch(() => undefined)
    throw toSshError(err)
  }
}

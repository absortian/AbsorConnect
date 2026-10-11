import { app, safeStorage } from 'electron'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { ApiError, apiRequest } from './apiClient'

// Sesión de este equipo: { email, token } en userData/session.json, con el token cifrado
// con safeStorage (Llavero en macOS, DPAPI en Windows, libsecret/kwallet en Linux).
// En Linux sin keyring se guarda sin cifrar y Ajustes lo indica.
const SESSION_PATH = path.join(app.getPath('userData'), 'session.json')

export interface Session {
  token: string
  email: string
}

interface SessionFile {
  email: string
  token: string
  encrypted: boolean
}

let current: Session | null = null
let loaded = false

/**
 * Lee la sesión guardada. Solo toca safeStorage si hay fichero: sin sesión, arrancar la
 * app no accede al Llavero (en macOS eso puede abrir un diálogo).
 */
export async function loadSession(): Promise<Session | null> {
  if (loaded) return current
  loaded = true
  let file: Partial<SessionFile>
  try {
    file = JSON.parse(await fs.readFile(SESSION_PATH, 'utf-8'))
  } catch {
    return null
  }
  if (typeof file.email !== 'string' || typeof file.token !== 'string') {
    await forgetSession()
    return null
  }
  try {
    const token = file.encrypted ? safeStorage.decryptString(Buffer.from(file.token, 'base64')) : file.token
    current = { token, email: file.email }
  } catch {
    // El almacén seguro ya no puede descifrarlo (llavero distinto): hay que volver a entrar
    await forgetSession()
  }
  return current
}

export function currentSession(): Session | null {
  return current
}

export async function storeSession(session: Session): Promise<void> {
  const encrypted = safeStorage.isEncryptionAvailable()
  const file: SessionFile = {
    email: session.email,
    token: encrypted ? safeStorage.encryptString(session.token).toString('base64') : session.token,
    encrypted
  }
  const tmpPath = `${SESSION_PATH}.tmp`
  await fs.writeFile(tmpPath, JSON.stringify(file), { encoding: 'utf-8', mode: 0o600 })
  await fs.rename(tmpPath, SESSION_PATH)
  current = session
  loaded = true
}

export async function forgetSession(): Promise<void> {
  current = null
  loaded = true
  await fs.rm(SESSION_PATH, { force: true })
}

/** Petición autenticada con el token de la sesión actual. */
export async function authRequest<T>(method: string, apiPath: string, body?: unknown): Promise<T> {
  if (!current) throw new ApiError('unauthenticated', 401)
  return apiRequest<T>(method, apiPath, { token: current.token, body })
}

/** Nombre con el que el servicio identifica este equipo entre las sesiones de la cuenta. */
export function deviceName(): string {
  return os.hostname()
}

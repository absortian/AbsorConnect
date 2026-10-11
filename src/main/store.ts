import { app, safeStorage } from 'electron'
import * as fs from 'fs/promises'
import * as path from 'path'
import { ConnectionEntry } from '../shared/types'
import { SECRET_FIELDS, normalizeEntry } from '../shared/connections'

const STORE_PATH = path.join(app.getPath('userData'), 'connections.json')
const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json')

export interface StoreStatus {
  unreadableCredentials: number
  recoveredFile: string | null
}

// Estado de la última lectura: lo consulta el renderer para avisar al usuario
let unreadableCredentials = 0
let recoveredFile: string | null = null
let readFailed = false

// No consulta safeStorage: en macOS eso accede al Llavero (y puede abrir un diálogo que bloquea
// el proceso principal), y el estado se pide en cada arranque
export function getStoreStatus(): StoreStatus {
  return { unreadableCredentials, recoveredFile }
}

// Solo para la nota de Ajustes. En macOS (Llavero) y Windows (DPAPI) el almacén seguro siempre
// existe; solo Linux depende de que haya keyring (libsecret/kwallet)
export function isEncryptionAvailable(): boolean {
  return process.platform === 'linux' ? safeStorage.isEncryptionAvailable() : true
}

// safeStorage (OSCrypt) produce blobs que empiezan por "v10" o "v11"; cualquier otro valor
// es un secreto en claro, aunque la entrada diga _encrypted (v0.0.x en Linux sin keyring)
function isEncryptedBlob(value: string): boolean {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false
  const prefix = Buffer.from(value, 'base64').subarray(0, 3).toString('latin1')
  return prefix === 'v10' || prefix === 'v11'
}

function secretFields(entry: { type?: unknown }): readonly string[] {
  return SECRET_FIELDS[entry.type as keyof typeof SECRET_FIELDS] ?? []
}

function decryptEntry(entry: ConnectionEntry): ConnectionEntry {
  const result: Record<string, unknown> = { ...entry }
  delete result._encrypted
  if (result.isFolder) return result as unknown as ConnectionEntry
  let unreadable = false
  for (const field of secretFields(result)) {
    const value = result[field]
    if (typeof value !== 'string' || value === '' || !isEncryptedBlob(value)) continue
    try {
      result[field] = safeStorage.decryptString(Buffer.from(value, 'base64'))
    } catch {
      // Se conserva en disco: saveConnections recupera el valor cifrado original
      result[field] = ''
      unreadable = true
    }
  }
  if (unreadable) result.credentialsUnavailable = true
  return result as unknown as ConnectionEntry
}

// Entradas de versiones anteriores (sin tipo) pasan a S3; una entrada no reconocible
// se conserva tal cual para no perderla al volver a guardar
function toEntry(raw: unknown): ConnectionEntry {
  try {
    return normalizeEntry(raw)
  } catch (error) {
    console.error('Keeping unrecognized connection entry as-is:', (error as Error).message)
    return raw as ConnectionEntry
  }
}

async function readRawEntries(): Promise<unknown[] | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(STORE_PATH, 'utf-8'))
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

export async function getConnections(): Promise<ConnectionEntry[]> {
  let data: string
  try {
    data = await fs.readFile(STORE_PATH, 'utf-8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      readFailed = false
      unreadableCredentials = 0
      return [] // File doesn't exist yet
    }
    // No se pudo leer (permisos…): no se permitirá guardar encima de lo que no se leyó
    console.error('Failed to read connections:', error)
    readFailed = true
    return []
  }
  readFailed = false

  let entries: unknown
  try {
    entries = JSON.parse(data)
  } catch {
    entries = null
  }
  if (!Array.isArray(entries)) {
    // Fichero dañado: se aparta a una copia con fecha en lugar de sobrescribirlo
    const backup = `${STORE_PATH}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`
    await fs.rename(STORE_PATH, backup)
    console.error('Connections file is not valid JSON; moved to', backup)
    recoveredFile = backup
    unreadableCredentials = 0
    return []
  }

  const result = entries.map(toEntry).map(decryptEntry)
  unreadableCredentials = result.filter((e) => !e.isFolder && e.credentialsUnavailable).length
  return result
}

function encryptEntry(entry: ConnectionEntry, stored: Record<string, unknown> | undefined): Record<string, unknown> {
  const result: Record<string, unknown> = { ...entry }
  const credentialsUnavailable = result.credentialsUnavailable === true
  delete result.credentialsUnavailable
  delete result._encrypted
  if (result.isFolder) return result
  // Se consulta solo si hay algo que cifrar, para no tocar el almacén seguro sin necesidad
  let canEncrypt: boolean | undefined
  let allEncrypted = true
  for (const field of secretFields(result)) {
    const value = result[field]
    if (credentialsUnavailable && (value === '' || value === undefined) && typeof stored?.[field] === 'string') {
      // Secreto ilegible que el usuario no ha reemplazado: se conserva tal cual estaba
      result[field] = stored[field]
    } else if (typeof value === 'string' && value !== '') {
      canEncrypt ??= safeStorage.isEncryptionAvailable()
      if (canEncrypt) result[field] = safeStorage.encryptString(value).toString('base64')
    }
    const final = result[field]
    if (typeof final === 'string' && final !== '' && !isEncryptedBlob(final)) allEncrypted = false
  }
  return allEncrypted ? { ...result, _encrypted: true } : result
}

export async function saveConnections(connections: ConnectionEntry[]): Promise<void> {
  if (readFailed) {
    throw new Error('Connections file could not be read; refusing to overwrite it')
  }
  try {
    const storedById = new Map<string, Record<string, unknown>>()
    for (const raw of (await readRawEntries()) ?? []) {
      if (raw && typeof raw === 'object' && typeof (raw as { id?: unknown }).id === 'string') {
        storedById.set((raw as { id: string }).id, raw as Record<string, unknown>)
      }
    }
    const serialized = JSON.stringify(connections.map((c) => encryptEntry(c, storedById.get(c.id))), null, 2)
    // Escritura atómica: temporal + renombrado, guardando antes la versión anterior en .bak
    const tmpPath = `${STORE_PATH}.tmp`
    await fs.writeFile(tmpPath, serialized, 'utf-8')
    await fs.copyFile(STORE_PATH, `${STORE_PATH}.bak`).catch((error) => {
      if (error.code !== 'ENOENT') throw error
    })
    await fs.rename(tmpPath, STORE_PATH)
  } catch (error) {
    console.error('Failed to save connections:', error)
    throw error
  }
}

interface Settings {
  theme: 'dark' | 'light'
  language: 'en' | 'es'
}

function getSystemLanguage(): 'en' | 'es' {
  const locale = app.getLocale() // e.g. "es", "es-419", "en-US"
  return locale.startsWith('es') ? 'es' : 'en'
}

async function readSettings(): Promise<Settings> {
  try {
    const data = await fs.readFile(SETTINGS_PATH, 'utf-8')
    const parsed = JSON.parse(data)
    return { theme: 'dark', language: getSystemLanguage(), ...parsed }
  } catch {
    return { theme: 'dark', language: getSystemLanguage() }
  }
}

async function writeSettings(settings: Settings): Promise<void> {
  await fs.writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8')
}

export async function getTheme(): Promise<string> {
  const settings = await readSettings()
  return settings.theme
}

export async function saveTheme(theme: string): Promise<void> {
  const settings = await readSettings()
  settings.theme = theme as 'dark' | 'light'
  await writeSettings(settings)
}

export async function getLanguage(): Promise<string> {
  const settings = await readSettings()
  return settings.language
}

export async function saveLanguage(language: string): Promise<void> {
  const settings = await readSettings()
  settings.language = language as 'en' | 'es'
  await writeSettings(settings)
}

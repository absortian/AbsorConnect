import { app, safeStorage } from 'electron'
import * as fs from 'fs/promises'
import * as path from 'path'
import { ConnectionEntry } from '../shared/types'
import { SECRET_FIELDS, normalizeEntry } from '../shared/connections'

const STORE_PATH = path.join(app.getPath('userData'), 'connections.json')
const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json')

function encryptField(value: string): string {
  if (!safeStorage.isEncryptionAvailable()) return value
  return safeStorage.encryptString(value).toString('base64')
}

function decryptField(value: string): string {
  if (!safeStorage.isEncryptionAvailable()) return value
  return safeStorage.decryptString(Buffer.from(value, 'base64'))
}

// Aplica `transform` a los campos secretos no vacíos del tipo de la entrada
function mapSecrets(
  entry: Record<string, unknown>,
  transform: (value: string) => string
): Record<string, unknown> {
  const result = { ...entry }
  const fields = SECRET_FIELDS[entry.type as keyof typeof SECRET_FIELDS] ?? []
  for (const field of fields) {
    const value = result[field]
    if (typeof value === 'string' && value !== '') result[field] = transform(value)
  }
  return result
}

function encryptEntry(entry: ConnectionEntry): ConnectionEntry {
  if (entry.isFolder) return entry
  return { ...mapSecrets({ ...entry }, encryptField), _encrypted: true } as ConnectionEntry
}

function decryptEntry(entry: ConnectionEntry): ConnectionEntry {
  const { _encrypted, ...rest } = entry
  if (!_encrypted || rest.isFolder) return rest as ConnectionEntry
  return mapSecrets(rest, decryptField) as unknown as ConnectionEntry
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

export async function getConnections(): Promise<ConnectionEntry[]> {
  try {
    const data = await fs.readFile(STORE_PATH, 'utf-8')
    const entries: unknown[] = JSON.parse(data)
    return entries.map(toEntry).map(decryptEntry)
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return [] // File doesn't exist yet
    }
    console.error('Failed to read connections:', error)
    return []
  }
}

export async function saveConnections(connections: ConnectionEntry[]): Promise<void> {
  try {
    const encrypted = connections.map(encryptEntry)
    await fs.writeFile(STORE_PATH, JSON.stringify(encrypted, null, 2), 'utf-8')
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

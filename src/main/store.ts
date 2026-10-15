import { app, safeStorage } from 'electron'
import * as fs from 'fs/promises'
import * as path from 'path'
import { ConnectionEntry } from '../shared/types'
import { SECRET_FIELDS, normalizeEntry } from '../shared/connections'

// connections.json de las versiones sin cuenta: ya no se escribe, solo se lee para migrarlo a la
// nube (cloud/migration.ts). settings.json (tema e idioma) sigue siendo local a cada equipo.
const STORE_PATH = path.join(app.getPath('userData'), 'connections.json')
const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json')

export interface StoreStatus {
  unreadableCredentials: number
  recoveredFile: string | null
}

// Estado de la última lectura, para el aviso de la migración
let unreadableCredentials = 0
let recoveredFile: string | null = null

// No consulta safeStorage: en macOS eso accede al Llavero (y puede abrir un diálogo que bloquea
// el proceso principal)
export function getStoreStatus(): StoreStatus {
  return { unreadableCredentials, recoveredFile }
}

// Solo para la nota de Ajustes sobre la sesión. En macOS (Llavero) y Windows (DPAPI) el almacén
// seguro siempre existe; solo Linux depende de que haya keyring (libsecret/kwallet)
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
      // La migración la sube sin secreto y marcada, para que se reintroduzca
      result[field] = ''
      unreadable = true
    }
  }
  if (unreadable) result.credentialsUnavailable = true
  return result as unknown as ConnectionEntry
}

// Entradas de versiones anteriores (sin tipo) pasan a S3; una entrada no reconocible se
// devuelve tal cual y la migración la deja fuera
function toEntry(raw: unknown): ConnectionEntry {
  try {
    return normalizeEntry(raw)
  } catch (error) {
    console.error('Keeping unrecognized connection entry as-is:', (error as Error).message)
    return raw as ConnectionEntry
  }
}

export async function getConnections(): Promise<ConnectionEntry[]> {
  let data: string
  try {
    data = await fs.readFile(STORE_PATH, 'utf-8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      unreadableCredentials = 0
      return [] // No hay fichero de una versión anterior
    }
    // No se pudo leer (permisos…): no se ofrece la migración y el fichero queda intacto
    console.error('Failed to read connections:', error)
    return []
  }

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

// Tras subir las conexiones a la cuenta (migración): el fichero y su copia dejan de existir,
// porque las credenciales ya no se guardan en el equipo
export async function removeConnectionsFile(): Promise<void> {
  await Promise.all([STORE_PATH, `${STORE_PATH}.bak`].map((file) => fs.rm(file, { force: true })))
  unreadableCredentials = 0
}

interface Settings {
  theme: 'dark' | 'light'
  language: 'en' | 'es'
  // Segundo plano (add-remote-desktop, background-mode): ambos desactivados por defecto.
  keepInBackground: boolean
  openAtLogin: boolean
}

const SETTINGS_DEFAULTS: Pick<Settings, 'theme' | 'keepInBackground' | 'openAtLogin'> = {
  theme: 'dark',
  keepInBackground: false,
  openAtLogin: false
}

function getSystemLanguage(): 'en' | 'es' {
  const locale = app.getLocale() // e.g. "es", "es-419", "en-US"
  return locale.startsWith('es') ? 'es' : 'en'
}

async function readSettings(): Promise<Settings> {
  try {
    const data = await fs.readFile(SETTINGS_PATH, 'utf-8')
    const parsed = JSON.parse(data)
    return { ...SETTINGS_DEFAULTS, language: getSystemLanguage(), ...parsed }
  } catch {
    return { ...SETTINGS_DEFAULTS, language: getSystemLanguage() }
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

export interface BackgroundSettings {
  keepInBackground: boolean
  openAtLogin: boolean
}

export async function getBackgroundSettings(): Promise<BackgroundSettings> {
  const { keepInBackground, openAtLogin } = await readSettings()
  return { keepInBackground, openAtLogin }
}

export async function saveBackgroundSettings(
  values: Partial<BackgroundSettings>
): Promise<BackgroundSettings> {
  const settings = await readSettings()
  Object.assign(settings, values)
  await writeSettings(settings)
  return { keepInBackground: settings.keepInBackground, openAtLogin: settings.openAtLogin }
}

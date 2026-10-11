import { CloudResult, ConnectionEntry, MigrationOffer } from '../../shared/types'
import { SECRET_FIELDS, isConnection, normalizeEntry } from '../../shared/connections'
import { getConnections as readLocalConnections, getStoreStatus, removeConnectionsFile } from '../store'
import { errorCode } from './apiClient'
import { addConnections } from './cloudStore'

// Migración de connections.json (versiones sin cuenta) a la cuenta, tras iniciar sesión.
// La lectura usa store.ts tal cual: aparta un fichero dañado y descifra con safeStorage,
// incluidos los secretos en claro marcados como cifrados de versiones antiguas.

/** Entradas que la app reconoce; las que no (editadas a mano, de otra versión) no se suben. */
async function readLocalEntries(): Promise<ConnectionEntry[]> {
  return (await readLocalConnections()).filter((entry) => {
    try {
      normalizeEntry(entry)
      return true
    } catch {
      return false
    }
  })
}

export async function getMigrationOffer(): Promise<MigrationOffer> {
  const entries = await readLocalEntries()
  return { count: entries.filter(isConnection).length, recoveredFile: getStoreStatus().recoveredFile }
}

// Un secreto que este equipo no puede descifrar se sube vacío y con la marca: el servicio
// lo guarda como ilegible y la conexión sigue marcada hasta que se reintroduzca
function forUpload(entry: ConnectionEntry): ConnectionEntry {
  if (!isConnection(entry) || !entry.credentialsUnavailable) return entry
  const result: Record<string, unknown> = { ...entry }
  for (const field of SECRET_FIELDS[entry.type]) result[field] = ''
  return result as unknown as ConnectionEntry
}

/** Solo si la subida va bien se borran connections.json y su .bak. */
export async function migrateLocalConnections(): Promise<CloudResult> {
  const entries = (await readLocalEntries()).map(forUpload)
  if (entries.length > 0) {
    try {
      await addConnections(entries)
    } catch (error) {
      return { ok: false, code: errorCode(error) }
    }
  }
  await removeConnectionsFile()
  return { ok: true }
}

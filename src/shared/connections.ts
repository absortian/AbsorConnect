import { Connection, ConnectionEntry, ConnectionType } from './types'

// Campos que se cifran en disco, por tipo de conexión
export const SECRET_FIELDS: Record<ConnectionType, readonly string[]> = {
  s3: ['accessKeyId', 'secretAccessKey'],
  ssh: ['password', 'passphrase']
}

export const DEFAULT_SSH_PORT = 22

export function isConnection(entry: ConnectionEntry): entry is Connection {
  return entry.isFolder !== true
}

function fail(message: string): never {
  throw new Error(`Invalid connection entry: ${message}`)
}

function requireString(raw: Record<string, unknown>, field: string, allowEmpty = true): void {
  const value = raw[field]
  if (typeof value !== 'string' || (!allowEmpty && value.trim() === '')) {
    fail(`"${field}" must be a${allowEmpty ? '' : ' non-empty'} string`)
  }
}

/**
 * Normaliza una entrada leída de disco o de un fichero importado.
 * Las entradas sin `type` (versiones ≤ 0.0.7) se tratan como S3.
 * Lanza un error si la entrada no es una carpeta o una conexión reconocible.
 */
export function normalizeEntry(raw: unknown): ConnectionEntry {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) fail('not an object')
  const entry = raw as Record<string, unknown>
  requireString(entry, 'id', false)
  requireString(entry, 'name')

  if (entry.isFolder === true) {
    const { id, name, parentId } = entry as { id: string; name: string; parentId?: string | null }
    return { id, name, parentId: parentId ?? null, isFolder: true }
  }

  const type = entry.type ?? 's3'
  if (type === 's3') {
    requireString(entry, 'endpoint')
    requireString(entry, 'accessKeyId')
    requireString(entry, 'secretAccessKey')
    const rest = { ...entry }
    delete rest.isFolder
    return { ...rest, type: 's3' } as unknown as Connection
  }

  if (type === 'ssh') {
    requireString(entry, 'host', false)
    requireString(entry, 'username', false)
    const port = entry.port ?? DEFAULT_SSH_PORT
    if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
      fail('"port" must be an integer between 1 and 65535')
    }
    if (entry.authMethod !== 'password' && entry.authMethod !== 'privateKey') {
      fail('"authMethod" must be "password" or "privateKey"')
    }
    if (entry.authMethod === 'privateKey') requireString(entry, 'privateKeyPath', false)
    const rest = { ...entry }
    delete rest.isFolder
    return { ...rest, type: 'ssh', port } as unknown as Connection
  }

  return fail(`unknown type "${String(type)}"`)
}

/**
 * Deja la lista en una forma que el servicio acepta sin perder entradas: quita los ids
 * repetidos (se queda la primera), y las entradas cuyo padre no es una carpeta de la
 * lista, o que forman un ciclo, pasan a la raíz. Versiones antiguas podían dejar
 * huérfanos que la barra lateral no muestra.
 */
export function sanitizeTree(entries: ConnectionEntry[]): ConnectionEntry[] {
  const seenIds = new Set<string>()
  const unique = entries.filter((entry) => !seenIds.has(entry.id) && seenIds.add(entry.id))
  const folderIds = new Set(unique.filter((entry) => entry.isFolder).map((entry) => entry.id))
  const parentOf = new Map(unique.map((entry) => [entry.id, entry.parentId && folderIds.has(entry.parentId) ? entry.parentId : null]))
  for (const entry of unique) {
    const visited = new Set<string>()
    for (let id: string | null = entry.id; id !== null; id = parentOf.get(id) ?? null) {
      if (visited.has(id)) {
        parentOf.set(id, null) // rompe el ciclo en la entrada que se repite
        break
      }
      visited.add(id)
    }
  }
  return unique.map((entry) => (parentOf.get(entry.id) === (entry.parentId ?? null) ? entry : { ...entry, parentId: parentOf.get(entry.id) ?? null }))
}

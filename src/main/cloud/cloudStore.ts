import { BrowserWindow } from 'electron'
import { ConnectionEntry, ConnectionsChangedEvent } from '../../shared/types'
import { sanitizeTree } from '../../shared/connections'
import { ApiError } from './apiClient'
import { authRequest, currentSession } from './session'

// Conexiones de la cuenta: caché en memoria de la última lista recibida. Los consumidores
// (barra lateral, cola de transferencias, terminal) leen de aquí sin una petición por operación.

interface Snapshot {
  revision: number
  entries: ConnectionEntry[]
}

const REFRESH_AFTER_MS = 30_000

let cache: Snapshot | null = null
let lastReadAt = 0
// Cambia al cerrar sesión: una respuesta que llegue después es de la sesión anterior y se descarta
let generation = 0

// Todas las lecturas y escrituras van en fila: dos guardados seguidos deben usar cada uno la
// revisión que dejó el anterior, o el segundo chocaría consigo mismo con un 409.
let queue: Promise<unknown> = Promise.resolve()
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task)
  queue = run.catch(() => undefined)
  return run
}

function remember(snapshot: Snapshot, since: number): Snapshot {
  if (since !== generation) throw new ApiError('unauthenticated', 401)
  cache = { revision: snapshot.revision, entries: snapshot.entries }
  lastReadAt = Date.now()
  return cache
}

async function request(method: string, body?: unknown): Promise<Snapshot> {
  const since = generation
  return remember(await authRequest<Snapshot>(method, '/api/connections', body), since)
}

function fetchSnapshot(): Promise<Snapshot> {
  return request('GET')
}

function notifyChanged(event: ConnectionsChangedEvent): void {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send('connections-changed', event)
}

/** El cuerpo del 409 trae la lista actual: con ella se rehace la caché. */
function conflictSnapshot(error: ApiError): Snapshot | null {
  const body = error.body as Partial<Snapshot> | null
  return body && typeof body.revision === 'number' && Array.isArray(body.entries) ? { revision: body.revision, entries: body.entries } : null
}

export function getConnections(): Promise<ConnectionEntry[]> {
  if (cache) return Promise.resolve(cache.entries)
  return serialized(async () => (cache ?? (await fetchSnapshot())).entries)
}

/** Carga la lista de la cuenta (al arrancar con sesión o tras iniciarla). */
export function loadConnections(): Promise<void> {
  return serialized(async () => {
    await fetchSnapshot()
  })
}

export function saveConnections(entries: ConnectionEntry[]): Promise<void> {
  return serialized(async () => {
    const since = generation
    const { revision } = cache ?? (await fetchSnapshot())
    try {
      await request('PUT', { revision, entries })
    } catch (error) {
      const latest = error instanceof ApiError && error.code === 'connections_conflict' ? conflictSnapshot(error) : null
      if (latest) {
        remember(latest, since)
        notifyChanged({ conflict: true })
      }
      throw error
    }
  })
}

/**
 * Añade a la cuenta las entradas cuyo id no esté ya en ella (migración de connections.json)
 * sobre la lista recién leída. Un conflicto se propaga sin el aviso de "tu cambio no se guardó".
 */
export function addConnections(entries: ConnectionEntry[]): Promise<void> {
  return serialized(async () => {
    const since = generation
    const snapshot = await fetchSnapshot()
    const existing = new Set(snapshot.entries.map((entry) => entry.id))
    const merged = sanitizeTree([...snapshot.entries, ...entries.filter((entry) => !existing.has(entry.id))])
    try {
      await request('PUT', { revision: snapshot.revision, entries: merged })
    } catch (error) {
      const latest = error instanceof ApiError && error.code === 'connections_conflict' ? conflictSnapshot(error) : null
      if (latest) remember(latest, since)
      throw error
    }
    notifyChanged({ conflict: false })
  })
}

/** Al volver a la ventana: si la última lectura tiene más de 30 s, se relee y se avisa si cambió. */
export function refreshIfStale(): void {
  if (!currentSession() || !cache || Date.now() - lastReadAt < REFRESH_AFTER_MS) return
  serialized(async () => {
    const before = cache?.revision
    const snapshot = await fetchSnapshot()
    if (snapshot.revision !== before) notifyChanged({ conflict: false })
  }).catch(() => {
    // Sin servicio: se reintentará al volver a la ventana; un 401 ya lo gestiona la sesión
  })
}

export function clearConnections(): void {
  generation++
  cache = null
  lastReadAt = 0
}

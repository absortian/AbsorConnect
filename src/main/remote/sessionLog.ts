// Registro local de las últimas sesiones e intentos (add-remote-desktop, remote-access-host). Solo
// en el equipo, nunca se envía al servicio. Lógica pura, acotada a 50 eventos.
export const MAX_LOG_ENTRIES = 50

export type RemoteLogType = 'session-start' | 'session-end' | 'auth-failed' | 'locked'

export interface RemoteLogEntry {
  at: number // epoch ms
  type: RemoteLogType
  controller?: string // nombre del equipo controlador, cuando aplica
  durationMs?: number // en 'session-end'
}

/** Añade un evento al principio y conserva como mucho los 50 más recientes. */
export function appendLog(log: RemoteLogEntry[], entry: RemoteLogEntry): RemoteLogEntry[] {
  return [entry, ...log].slice(0, MAX_LOG_ENTRIES)
}

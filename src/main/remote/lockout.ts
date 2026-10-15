// Bloqueo tras intentos fallidos de contraseña del PC (add-remote-desktop D6, remote-access-host).
// Lógica pura: 5 fallos en 15 minutos bloquean el acceso 15 minutos. Los fallos se persisten, así
// que reiniciar la app no reinicia el contador.
export const MAX_FAILURES = 5
export const FAILURE_WINDOW_MS = 15 * 60_000
export const LOCK_MS = 15 * 60_000

export interface LockState {
  failures: number[] // marcas de tiempo (ms) de los fallos recientes
  lockedUntil: number | null
}

export function recentFailures(failures: number[], now: number): number[] {
  return failures.filter((t) => now - t < FAILURE_WINDOW_MS)
}

export function isLocked(state: LockState, now: number): boolean {
  return state.lockedUntil != null && state.lockedUntil > now
}

/** Segundos que faltan para poder reintentar (0 si no está bloqueado). */
export function lockRemainingSeconds(state: LockState, now: number): number {
  return isLocked(state, now) ? Math.ceil(((state.lockedUntil as number) - now) / 1000) : 0
}

/** Registra un fallo; al llegar a MAX_FAILURES en la ventana, bloquea. */
export function registerFailure(state: LockState, now: number): LockState {
  const failures = [...recentFailures(state.failures, now), now]
  const lockedUntil = failures.length >= MAX_FAILURES ? now + LOCK_MS : state.lockedUntil
  return { failures, lockedUntil }
}

/** Un acceso correcto reinicia la cuenta de fallos y el bloqueo. */
export function clearFailures(): LockState {
  return { failures: [], lockedUntil: null }
}

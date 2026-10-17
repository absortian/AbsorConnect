import { BrowserWindow } from 'electron'
import { CloudResult, SessionState, SignInResult } from '../../shared/types'
import { closeAllSsh } from '../ssh'
import { ApiError, apiRequest, errorCode } from './apiClient'
import { clearConnections, loadConnections } from './cloudStore'
import { authRequest, currentSession, deviceName, forgetSession, loadSession, storeSession } from './session'

/** Estado al arrancar: con sesión guardada se precargan las conexiones, que de paso la validan. */
export async function getSessionState(): Promise<SessionState> {
  const session = await loadSession()
  if (!session) return { state: 'signed-out' }
  try {
    await loadConnections()
    return { state: 'signed-in', email: session.email }
  } catch (error) {
    // 401: caducó o se revocó con la app cerrada (expireSession ya la ha olvidado). Cualquier
    // otro fallo (sin red, 5xx, URL mal configurada) es "servicio no disponible", con reintento
    if (error instanceof ApiError && error.status === 401) return { state: 'signed-out', expired: true }
    return { state: 'unreachable' }
  }
}

async function signIn(apiPath: string, email: string, password: string): Promise<SignInResult> {
  try {
    const result = await apiRequest<{ token: string; user: { email: string } }>('POST', apiPath, {
      body: { email, password, deviceName: deviceName() }
    })
    clearConnections()
    await storeSession({ token: result.token, email: result.user.email })
    return { ok: true, email: result.user.email }
  } catch (error) {
    return { ok: false, code: errorCode(error) }
  }
}

export function login(email: string, password: string): Promise<SignInResult> {
  return signIn('/api/auth/login', email, password)
}

export function register(email: string, password: string): Promise<SignInResult> {
  return signIn('/api/auth/register', email, password)
}

/** Por qué se sale de la cuenta en este equipo. */
export type AccountExit = 'signed_out' | 'expired' | 'deleted'

/**
 * Lo que se corta fuera de este módulo al salir de la cuenta: el control remoto, en los dos papeles
 * (tarea 4.10). Lo fija index.ts. Recibe el token que había, porque dar de baja el equipo lo
 * necesita y se hace después de olvidarlo.
 */
type AccountExitHandler = (exit: AccountExit, token: string | null) => Promise<void>
let onAccountExit: AccountExitHandler = async () => {}

export function setAccountExitHandler(handler: AccountExitHandler): void {
  onAccountExit = handler
}

/**
 * Fuera de la cuenta en este equipo: ni conexiones en memoria, ni SSH abiertas, ni control remoto,
 * ni token. El control remoto se corta en el momento, pero lo que aún hace con el token (dar de
 * baja el equipo) sigue en segundo plano: se devuelve para no revocar la sesión antes.
 */
async function endLocalSession(exit: AccountExit): Promise<{ remoteDone: Promise<void> }> {
  const remoteDone = onAccountExit(exit, currentSession()?.token ?? null).catch(() => undefined)
  clearConnections()
  closeAllSsh()
  await forgetSession()
  return { remoteDone }
}

/** Lo local se borra ya; la revocación en el servicio se intenta sin hacer esperar a nadie. */
export async function logout(): Promise<CloudResult> {
  const session = currentSession()
  const { remoteDone } = await endLocalSession('signed_out')
  if (session) {
    void remoteDone.then(() =>
      apiRequest('POST', '/api/auth/logout', { token: session.token }).catch(() => {})
    )
  }
  return { ok: true }
}

/** Un 401 en una llamada autenticada: la sesión ya no vale (caducada, revocada o cuenta borrada). */
export function expireSession(): void {
  if (!currentSession()) return
  void endLocalSession('expired')
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send('session-expired')
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<CloudResult> {
  try {
    await authRequest('PUT', '/api/me/password', { currentPassword, newPassword })
    return { ok: true }
  } catch (error) {
    return { ok: false, code: errorCode(error) }
  }
}

export async function deleteAccount(password: string): Promise<CloudResult> {
  try {
    await authRequest('DELETE', '/api/me', { password })
  } catch (error) {
    return { ok: false, code: errorCode(error) }
  }
  await endLocalSession('deleted')
  return { ok: true }
}

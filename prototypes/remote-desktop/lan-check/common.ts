// Lo común de la prueba entre dos equipos (lan-check): argumentos, API, cuenta de prueba e informe.
import * as os from 'os'

export const args: Record<string, string> = Object.fromEntries(
  process.argv
    .filter((a) => a.startsWith('--') && a.includes('='))
    .map((a) => [a.slice(2, a.indexOf('=')), a.slice(a.indexOf('=') + 1)])
)
export const API = (args.api ?? 'http://127.0.0.1:8020').replace(/\/+$/, '')
export const TEST_EMAIL = 'prueba-control-local@example.test'
export const ACCOUNT_PASSWORD = 'contraseña-de-prueba-larga'
export const PC_PASSWORD = 'contraseña-del-pc-prueba'
export const NEW_PC_PASSWORD = 'contraseña-del-pc-nueva'
export const PROBE_PORT = 8790
/** El nombre del PC de prueba lleva la dirección de su sonda: "PC de prueba macOS @192.168.1.50:8790". */
export const PC_PREFIX = 'PC de prueba'

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export interface Check {
  name: string
  ok: boolean | null
  detail: unknown
}

export function createReport(role: string): {
  report: { role: string; system: Record<string, unknown>; checks: Check[]; notes: string[]; error: string | null }
  check: (name: string, ok: boolean | null, detail?: unknown) => void
  note: (text: string) => void
} {
  const report = {
    role,
    system: { platform: process.platform, release: os.release(), arch: process.arch, hostname: os.hostname() },
    checks: [] as Check[],
    notes: [] as string[],
    error: null as string | null
  }
  return {
    report,
    // ok === null: no se ha podido comprobar (por ejemplo, sin una segunda pantalla)
    check: (name, ok, detail = null) => {
      report.checks.push({ name, ok, detail })
      const mark = ok === null ? 'SIN PROBAR' : ok ? 'OK   ' : 'FALLO'
      console.log(`${mark} ${name} ${String(JSON.stringify(detail)).slice(0, 300)}`)
    },
    note: (text) => {
      report.notes.push(text)
      console.log(`NOTA  ${text}`)
    }
  }
}

export async function api(
  method: string,
  pathname: string,
  token?: string,
  body?: unknown
): Promise<{ status: number; data: any }> {
  const response = await fetch(`${API}${pathname}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000)
  })
  const text = await response.text()
  return { status: response.status, data: text ? JSON.parse(text) : null }
}

/** Sesión de la cuenta de prueba; la crea si no existe (la primera vez, en cualquiera de los dos equipos). */
export async function login(deviceName: string): Promise<string> {
  let result = await api('POST', '/api/auth/login', undefined, { email: TEST_EMAIL, password: ACCOUNT_PASSWORD, deviceName })
  if (result.status !== 200) {
    result = await api('POST', '/api/auth/register', undefined, { email: TEST_EMAIL, password: ACCOUNT_PASSWORD, deviceName })
  }
  if (result.status !== 200 && result.status !== 201) {
    // Los dos equipos a la vez: el otro acaba de crearla
    await sleep(2000)
    result = await api('POST', '/api/auth/login', undefined, { email: TEST_EMAIL, password: ACCOUNT_PASSWORD, deviceName })
  }
  if (typeof result.data?.token !== 'string') throw new Error(`Sin sesión de prueba: ${JSON.stringify(result)}`)
  return result.data.token
}

export function systemName(platform = process.platform): string {
  return platform === 'darwin' ? 'macOS' : platform === 'win32' ? 'Windows' : 'Linux'
}

/**
 * La IPv4 de la red local con la que el otro equipo llega a este: la de la misma red que el
 * backend si se llega a él por la red, y si no la primera de una interfaz física.
 */
export function lanAddress(): string {
  if (args.advertise) return args.advertise
  const candidates = Object.entries(os.networkInterfaces())
    .filter(([name]) => !/^(docker|br-|veth|virbr|utun|lo|vmnet|vboxnet|tun|tap|bridge)/.test(name))
    .flatMap(([, list]) => (list ?? []).filter((a) => a.family === 'IPv4' && !a.internal).map((a) => a.address))
  const apiHost = new URL(API).hostname
  if (/^\d+\.\d+\.\d+\.\d+$/.test(apiHost) && !apiHost.startsWith('127.')) {
    const prefix = apiHost.split('.').slice(0, 3).join('.') + '.'
    const same = candidates.find((a) => a.startsWith(prefix))
    if (same) return same
  }
  const found = candidates.find((a) => !/^172\.(1[6-9]|2\d|3[01])\./.test(a)) ?? candidates[0]
  if (!found) throw new Error('No encuentro la IP de la red local: pásala con --advertise=<ip>')
  return found
}

export function describeError(error: unknown): string {
  return String(error instanceof Error ? (error.stack ?? error) : error)
}

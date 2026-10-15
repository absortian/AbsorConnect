// Cliente de la API de cuentas y conexiones (backend/, contrato en add-cloud-backend D4).
// Vive en el proceso principal: el token nunca llega al renderer.

const TIMEOUT_MS = 15_000

/** Error de la API con su código estable (`invalid_credentials`, `connections_conflict`…) o `network_error`. */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly body: unknown = null
  ) {
    super(code)
    this.name = 'ApiError'
  }
}

/** Sin respuesta útil del servicio: sin red, timeout o un 5xx del proxy o del backend. */
export function isUnavailable(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 0 || error.status >= 500)
}

export function errorCode(error: unknown): string {
  return error instanceof ApiError ? error.code : 'unknown_error'
}

// Incrustada al compilar (MAIN_VITE_API_URL en .env.production / .env.development).
// ABSOR_CONNECT_API_URL la sobrescribe para desarrollo y pruebas contra otro backend.
export function apiBaseUrl(): string {
  return (process.env.ABSOR_CONNECT_API_URL || import.meta.env.MAIN_VITE_API_URL || '').replace(/\/+$/, '')
}

let onUnauthorized: (() => void) | null = null

/** Se llama cuando una petición con token recibe un 401: la sesión caducó o se revocó. */
export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler
}

export async function apiRequest<T>(method: string, path: string, options: { token?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
  const { token, body, headers } = options
  const base = apiBaseUrl()
  if (!base) throw new ApiError('network_error', 0)

  let response: Response
  try {
    response = await fetch(`${base}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        // Cabeceras propias de algunas operaciones (X-Device-Key en las del equipo)
        ...headers
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
  } catch {
    throw new ApiError('network_error', 0)
  }

  if (response.status === 204) return undefined as T
  let data: unknown = null
  try {
    data = await response.json()
  } catch {
    // Cuerpo vacío o no JSON (por ejemplo, la página de error de un proxy)
  }
  if (!response.ok) {
    const code = (data as { error?: { code?: unknown } } | null)?.error?.code
    if (response.status === 401 && token) onUnauthorized?.()
    throw new ApiError(typeof code === 'string' ? code : response.status >= 500 ? 'server_error' : 'http_error', response.status, data)
  }
  return data as T
}

import type { TFunction } from 'i18next'

// Las operaciones de la cuenta devuelven { ok: false, code }; las de conexiones (getConnections,
// saveConnections) lanzan un error de IPC cuyo mensaje acaba en el código de la API
// ("Error invoking remote method 'save-connections': ApiError: connections_conflict")
const TRAILING_CODE = /\b([a-z]+(?:_[a-z]+)*)\s*$/

export function cloudErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.match(TRAILING_CODE)?.[1] ?? 'unknown'
}

export function cloudErrorMessage(code: string, t: TFunction): string {
  return t(`auth.errors.${code}`, { defaultValue: t('auth.errors.unknown') })
}

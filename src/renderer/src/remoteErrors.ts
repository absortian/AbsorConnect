import type { TFunction } from 'i18next'

const CODE_PATTERN = /\b((?:SSH|SFTP)_[A-Z_]+)\b/

// Traduce los errores SSH/SFTP del proceso principal ("CODE: detalle", envuelto por IPC)
// a un texto para el usuario; el resto de errores se muestran tal cual
export function remoteErrorMessage(message: string, t: TFunction): string {
  const code = message.match(CODE_PATTERN)?.[1]
  if (!code) return message
  const detail = message.slice(message.indexOf(code) + code.length).replace(/^:\s*/, '')
  return t(`errors.${code}`, { detail, defaultValue: message })
}

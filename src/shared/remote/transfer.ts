// Ficheros y portapapeles del control remoto (add-remote-desktop D9, tareas 6.3 y 6.5), compartido
// por el PC controlado, el visor y la app móvil.
//
// Ficheros, por el canal `file` (fiable y ordenado): mensajes JSON de texto y trozos binarios de hasta
// 64 KB con 4 bytes delante (el id de la transferencia, big-endian). Todo va por el mismo canal para
// que `file-end` no adelante a los últimos trozos. Los ids los elige siempre el controlador.
//   Envío al PC:     file-offer → file-accept | file-reject → trozos → file-end → file-done | file-error
//   Descarga del PC: file-request → file-start | file-reject → trozos → file-end
//   Carpetas del PC: fs-list → fs-entries
//   Los dos sentidos: file-cancel
//
// Portapapeles, por el canal `control`: `clipboard {id, kind, index, count, data}` en trozos de texto
// (los mensajes de WebRTC no pueden pasar de 256 KB). Una imagen va en PNG y en base64.

export const CHUNK_BYTES = 64 * 1024
/** Se deja de enviar mientras el canal tenga más de esto pendiente (control de presión). */
export const BUFFER_HIGH_BYTES = 1024 * 1024
export const CLIPBOARD_TEXT_MAX_BYTES = 1024 * 1024
export const CLIPBOARD_IMAGE_MAX_BYTES = 10 * 1024 * 1024
/** Caracteres de cada trozo del portapapeles (con el JSON, muy por debajo de 256 KB). */
export const CLIPBOARD_PIECE_CHARS = 60_000
const MAX_NAME_CHARS = 255
const MAX_PATH_CHARS = 4096
const MAX_ENTRIES = 5000

export type TransferRejectReason =
  | 'disabled'
  | 'not_found'
  | 'denied'
  | 'is_directory'
  | 'io'
  | 'busy'
export type TransferErrorReason = 'integrity' | 'io' | 'size'

export interface FsEntry {
  name: string
  dir: boolean
  size: number
  /** Milisegundos desde 1970. */
  mtime: number
}

export type TransferMessage =
  | { type: 'file-offer'; id: number; name: string; size: number }
  | { type: 'file-accept'; id: number }
  | { type: 'file-reject'; id: number; reason: TransferRejectReason }
  | { type: 'file-end'; id: number; sha256: string }
  | { type: 'file-done'; id: number; name: string }
  | { type: 'file-error'; id: number; reason: TransferErrorReason }
  | { type: 'file-cancel'; id: number }
  | { type: 'file-request'; id: number; path: string }
  | { type: 'file-start'; id: number; name: string; size: number }
  | { type: 'fs-list'; id: number; path: string }
  | {
      type: 'fs-entries'
      id: number
      path: string
      parent: string | null
      entries: FsEntry[]
      truncated?: boolean
      error?: TransferRejectReason
    }

const REJECT_REASONS = new Set<string>([
  'disabled',
  'not_found',
  'denied',
  'is_directory',
  'io',
  'busy'
])
const ERROR_REASONS = new Set<string>(['integrity', 'io', 'size'])

const isId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 0xffffffff
const isSize = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const isName = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_NAME_CHARS
const isPath = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= MAX_PATH_CHARS
const isSha = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)

function parseEntries(value: unknown): FsEntry[] | null {
  if (!Array.isArray(value) || value.length > MAX_ENTRIES) return null
  const entries: FsEntry[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) return null
    const e = item as Record<string, unknown>
    if (!isName(e.name) || typeof e.dir !== 'boolean' || !isSize(e.size)) return null
    entries.push({ name: e.name, dir: e.dir, size: e.size, mtime: Number(e.mtime) || 0 })
  }
  return entries
}

/** Valida un mensaje de texto del canal `file`; null si no se reconoce o no es válido. */
export function parseTransferMessage(raw: string): TransferMessage | null {
  let data: Record<string, unknown>
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    data = parsed
  } catch {
    return null
  }
  const { type, id } = data
  if (!isId(id)) return null
  switch (type) {
    case 'file-offer':
    case 'file-start':
      return isName(data.name) && isSize(data.size)
        ? { type, id, name: data.name, size: data.size }
        : null
    case 'file-accept':
    case 'file-cancel':
      return { type, id }
    case 'file-reject':
      return typeof data.reason === 'string' && REJECT_REASONS.has(data.reason)
        ? { type, id, reason: data.reason as TransferRejectReason }
        : null
    case 'file-end':
      return isSha(data.sha256) ? { type, id, sha256: data.sha256 } : null
    case 'file-done':
      return isName(data.name) ? { type, id, name: data.name } : null
    case 'file-error':
      return typeof data.reason === 'string' && ERROR_REASONS.has(data.reason)
        ? { type, id, reason: data.reason as TransferErrorReason }
        : null
    case 'file-request':
    case 'fs-list':
      return isPath(data.path) ? { type, id, path: data.path } : null
    case 'fs-entries': {
      const entries = parseEntries(data.entries)
      if (!isPath(data.path) || !entries) return null
      if (data.parent !== null && !isPath(data.parent)) return null
      const error =
        typeof data.error === 'string' && REJECT_REASONS.has(data.error)
          ? (data.error as TransferRejectReason)
          : undefined
      return {
        type,
        id,
        path: data.path,
        parent: data.parent as string | null,
        entries,
        ...(data.truncated === true ? { truncated: true } : {}),
        ...(error ? { error } : {})
      }
    }
    default:
      return null
  }
}

/** Trozo binario: 4 bytes con el id (big-endian) y los datos. */
export function encodeChunk(id: number, data: Uint8Array): Uint8Array {
  const frame = new Uint8Array(4 + data.length)
  new DataView(frame.buffer).setUint32(0, id)
  frame.set(data, 4)
  return frame
}

export function decodeChunk(
  frame: ArrayBuffer | Uint8Array
): { id: number; data: Uint8Array } | null {
  const bytes = frame instanceof Uint8Array ? frame : new Uint8Array(frame)
  if (bytes.length < 4 || bytes.length > 4 + CHUNK_BYTES) return null
  const id = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0)
  return isId(id) ? { id, data: bytes.subarray(4) } : null
}

// --- Portapapeles ----------------------------------------------------------------------------

/** Lo que se copia: texto, o una imagen en PNG (base64 en el protocolo, bytes en cada extremo). */
export type ClipboardContent = { kind: 'text'; text: string } | { kind: 'image'; png: Uint8Array }

export interface ClipboardPiece {
  v: 1
  type: 'clipboard'
  id: number
  kind: 'text' | 'image'
  index: number
  count: number
  data: string
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** El contenido cabe en los límites (texto de hasta 1 MB, imagen de hasta 10 MB). */
export function clipboardFits(content: ClipboardContent): boolean {
  return content.kind === 'text'
    ? content.text.length > 0 &&
        new TextEncoder().encode(content.text).length <= CLIPBOARD_TEXT_MAX_BYTES
    : content.png.length > 0 && content.png.length <= CLIPBOARD_IMAGE_MAX_BYTES
}

/** Trozos del portapapeles para el canal `control`; vacío si no cabe en los límites. */
export function splitClipboard(id: number, content: ClipboardContent): ClipboardPiece[] {
  if (!clipboardFits(content)) return []
  const data = content.kind === 'text' ? content.text : toBase64(content.png)
  const count = Math.max(1, Math.ceil(data.length / CLIPBOARD_PIECE_CHARS))
  return Array.from({ length: count }, (_, index) => ({
    v: 1 as const,
    type: 'clipboard' as const,
    id,
    kind: content.kind,
    index,
    count,
    data: data.slice(index * CLIPBOARD_PIECE_CHARS, (index + 1) * CLIPBOARD_PIECE_CHARS)
  }))
}

/** Valida un trozo del portapapeles recibido por el canal `control`. */
export function parseClipboardPiece(data: unknown): ClipboardPiece | null {
  if (typeof data !== 'object' || data === null) return null
  const m = data as Record<string, unknown>
  const maxCount = Math.ceil((CLIPBOARD_IMAGE_MAX_BYTES * 4) / 3 / CLIPBOARD_PIECE_CHARS) + 1
  if (
    m.type !== 'clipboard' ||
    !isId(m.id) ||
    (m.kind !== 'text' && m.kind !== 'image') ||
    !Number.isInteger(m.count) ||
    (m.count as number) < 1 ||
    (m.count as number) > maxCount ||
    !Number.isInteger(m.index) ||
    (m.index as number) < 0 ||
    (m.index as number) >= (m.count as number) ||
    typeof m.data !== 'string' ||
    m.data.length > CLIPBOARD_PIECE_CHARS
  ) {
    return null
  }
  return {
    v: 1,
    type: 'clipboard',
    id: m.id,
    kind: m.kind,
    index: m.index as number,
    count: m.count as number,
    data: m.data
  }
}

/** Junta los trozos del portapapeles. Uno nuevo descarta el que estuviera a medias. */
export class ClipboardAssembler {
  private current: { id: number; kind: 'text' | 'image'; count: number; parts: string[] } | null =
    null

  add(piece: ClipboardPiece): ClipboardContent | null {
    if (piece.index === 0) {
      this.current = { id: piece.id, kind: piece.kind, count: piece.count, parts: [] }
    }
    const current = this.current
    // Fuera de orden o de otro envío: se descarta (el canal es ordenado, así que no debería pasar)
    if (
      !current ||
      current.id !== piece.id ||
      current.kind !== piece.kind ||
      current.count !== piece.count ||
      current.parts.length !== piece.index
    ) {
      this.current = null
      return null
    }
    current.parts.push(piece.data)
    if (current.parts.length < current.count) return null
    this.current = null
    const data = current.parts.join('')
    let content: ClipboardContent
    try {
      content =
        current.kind === 'text'
          ? { kind: 'text', text: data }
          : { kind: 'image', png: fromBase64(data) }
    } catch {
      return null
    }
    return clipboardFits(content) ? content : null
  }
}

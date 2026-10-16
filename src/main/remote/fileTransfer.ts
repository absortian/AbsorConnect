// Ficheros del control remoto en el proceso principal (add-remote-desktop D9, tareas 6.3 y 6.5).
//   - FileSink: escribe un `.part` en orden, calculando su SHA-256, y lo da por bueno solo si el
//     resumen coincide con el del otro extremo.
//   - HostFiles: lo del PC controlado. Recibe en `Descargas/Absor Connect` con un nombre libre (sin
//     sobrescribir nunca), lista carpetas y lee ficheros para que el controlador los descargue.
import { createHash, Hash, randomUUID } from 'crypto'
import { constants, promises as fs } from 'fs'
import * as os from 'os'
import * as path from 'path'
import type {
  FsEntry,
  TransferErrorReason,
  TransferRejectReason
} from '../../shared/remote/transfer'
import { CHUNK_BYTES } from '../../shared/remote/transfer'

const MAX_LISTED = 5000
/** En Windows, la carpeta "Este equipo" con las unidades. */
export const DRIVES_PATH = '::drives'
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

export class TransferError extends Error {
  constructor(readonly reason: TransferErrorReason) {
    super(reason)
  }
}

/** Un fichero que llega por trozos a un `.part`, con su resumen. */
export class FileSink {
  private readonly hash: Hash = createHash('sha256')
  private queue: Promise<unknown> = Promise.resolve()
  private written = 0
  private failed: TransferErrorReason | null = null
  private closed = false

  private constructor(
    readonly partPath: string,
    private readonly handle: fs.FileHandle,
    readonly size: number
  ) {}

  static async create(partPath: string, size: number): Promise<FileSink> {
    // `wx`: nunca se pisa un fichero que ya exista
    return new FileSink(partPath, await fs.open(partPath, 'wx', 0o600), size)
  }

  get bytes(): number {
    return this.written
  }

  /** Añade un trozo; se escriben en el orden en que llegan. */
  write(chunk: Uint8Array): void {
    if (this.closed || this.failed) return
    if (this.written + chunk.length > this.size) {
      this.failed = 'size'
      return
    }
    this.written += chunk.length
    this.hash.update(chunk)
    const data = Buffer.from(chunk)
    this.queue = this.queue.then(async () => {
      if (this.failed) return
      try {
        await this.handle.write(data)
      } catch {
        this.failed = 'io'
      }
    })
  }

  /** Cierra y comprueba tamaño y resumen; si algo falla, borra el `.part`. */
  async finish(sha256: string): Promise<void> {
    await this.queue
    await this.close()
    const reason: TransferErrorReason | null =
      this.failed ??
      (this.written !== this.size
        ? 'size'
        : this.hash.digest('hex') !== sha256
          ? 'integrity'
          : null)
    if (reason) {
      await fs.rm(this.partPath, { force: true })
      throw new TransferError(reason)
    }
  }

  async abort(): Promise<void> {
    await this.queue.catch(() => undefined)
    await this.close()
    await fs.rm(this.partPath, { force: true })
  }

  private async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await this.handle.close().catch(() => undefined)
  }
}

/**
 * Nombre que se puede guardar en cualquier sistema: sin carpetas, sin caracteres que Windows no
 * admite, sin nombres reservados (CON, NUL…) y de longitud razonable, conservando la extensión.
 */
export function sanitizeFileName(name: string): string {
  let clean = name
    .split(/[\\/]/)
    .pop()!
    .split('')
    .map((c) =>
      c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 || '<>:"|?*'.includes(c) ? '_' : c
    )
    .join('')
    .replace(/[. ]+$/, '')
    .trim()
  if (!clean || clean === '.' || clean === '..') clean = 'fichero'
  if (WINDOWS_RESERVED.test(clean)) clean = `_${clean}`
  if (clean.length > 200) {
    const ext = path.extname(clean).slice(0, 20)
    clean = clean.slice(0, 200 - ext.length) + ext
  }
  return clean
}

/** "informe.pdf", "informe (1).pdf", "informe (2).pdf"… */
function candidate(name: string, n: number): string {
  if (n === 0) return name
  const ext = path.extname(name)
  const base = ext ? name.slice(0, -ext.length) : name
  return `${base} (${n})${ext}`
}

/**
 * Lleva el `.part` comprobado a un nombre libre de `dir` sin sobrescribir nada. Con enlace duro la
 * operación es atómica (falla si el nombre ya existe); donde no se puede, se comprueba y se renombra.
 */
export async function placeWithFreeName(
  partPath: string,
  dir: string,
  name: string
): Promise<string> {
  for (let n = 0; n < 10_000; n++) {
    const finalName = candidate(name, n)
    const target = path.join(dir, finalName)
    try {
      await fs.link(partPath, target)
      await fs.rm(partPath, { force: true })
      return finalName
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EEXIST') continue
      // Sistema de ficheros sin enlaces duros (FAT, algunos montajes)
      try {
        await fs.access(target)
        continue
      } catch {
        await fs.rename(partPath, target)
        return finalName
      }
    }
  }
  throw new TransferError('io')
}

function rejectReason(error: unknown): TransferRejectReason {
  const code = (error as NodeJS.ErrnoException)?.code
  if (code === 'ENOENT' || code === 'ENOTDIR') return 'not_found'
  if (code === 'EACCES' || code === 'EPERM') return 'denied'
  if (code === 'EISDIR') return 'is_directory'
  return 'io'
}

export interface FsListing {
  path: string
  parent: string | null
  entries: FsEntry[]
  truncated?: boolean
  error?: TransferRejectReason
}

interface OpenRead {
  handle: fs.FileHandle
  hash: Hash
}

export class HostFiles {
  private readonly uploads = new Map<number, FileSink>()
  private readonly reads = new Map<number, OpenRead>()

  constructor(
    private readonly receiveDir: string,
    private readonly home = os.homedir(),
    private readonly platform: NodeJS.Platform = process.platform
  ) {}

  // --- Envío al PC -------------------------------------------------------------------------

  async begin(
    id: number,
    name: string,
    size: number
  ): Promise<{ ok: true } | { ok: false; reason: TransferRejectReason }> {
    if (this.uploads.has(id)) return { ok: false, reason: 'busy' }
    try {
      await fs.mkdir(this.receiveDir, { recursive: true })
      const part = path.join(
        this.receiveDir,
        `.${sanitizeFileName(name)}.${randomUUID().slice(0, 8)}.part`
      )
      this.uploads.set(id, await FileSink.create(part, size))
      return { ok: true }
    } catch (error) {
      return { ok: false, reason: rejectReason(error) }
    }
  }

  write(id: number, chunk: Uint8Array): void {
    this.uploads.get(id)?.write(chunk)
  }

  async finish(
    id: number,
    name: string,
    sha256: string
  ): Promise<{ ok: true; name: string } | { ok: false; reason: TransferErrorReason }> {
    const sink = this.uploads.get(id)
    if (!sink) return { ok: false, reason: 'io' }
    this.uploads.delete(id)
    try {
      await sink.finish(sha256)
      return {
        ok: true,
        name: await placeWithFreeName(sink.partPath, this.receiveDir, sanitizeFileName(name))
      }
    } catch (error) {
      await fs.rm(sink.partPath, { force: true })
      return { ok: false, reason: error instanceof TransferError ? error.reason : 'io' }
    }
  }

  async cancel(id: number): Promise<void> {
    const sink = this.uploads.get(id)
    this.uploads.delete(id)
    await sink?.abort()
  }

  // --- Carpetas y descargas desde el PC --------------------------------------------------------

  async list(requested: string): Promise<FsListing> {
    if (this.platform === 'win32' && requested === DRIVES_PATH) return this.drives()
    const dir = requested ? path.resolve(requested) : this.home
    const parent =
      path.dirname(dir) !== dir ? path.dirname(dir) : this.platform === 'win32' ? DRIVES_PATH : null
    try {
      const dirents = await fs.readdir(dir, { withFileTypes: true })
      const entries: FsEntry[] = []
      for (const dirent of dirents.slice(0, MAX_LISTED)) {
        try {
          const stat = await fs.stat(path.join(dir, dirent.name))
          entries.push({
            name: dirent.name,
            dir: stat.isDirectory(),
            size: stat.isDirectory() ? 0 : stat.size,
            mtime: Math.round(stat.mtimeMs)
          })
        } catch {
          // Enlaces rotos o sin permiso: no se pueden descargar, no se listan
        }
      }
      entries.sort((a, b) =>
        a.dir !== b.dir
          ? a.dir
            ? -1
            : 1
          : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
      )
      return {
        path: dir,
        parent,
        entries,
        ...(dirents.length > MAX_LISTED ? { truncated: true } : {})
      }
    } catch (error) {
      return { path: dir, parent, entries: [], error: rejectReason(error) }
    }
  }

  private async drives(): Promise<FsListing> {
    const entries: FsEntry[] = []
    for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZAB') {
      try {
        await fs.access(`${letter}:\\`)
        entries.push({ name: `${letter}:\\`, dir: true, size: 0, mtime: 0 })
      } catch {
        // No existe
      }
    }
    return { path: DRIVES_PATH, parent: null, entries }
  }

  async open(
    id: number,
    requested: string
  ): Promise<
    { ok: true; name: string; size: number } | { ok: false; reason: TransferRejectReason }
  > {
    if (this.reads.has(id)) return { ok: false, reason: 'busy' }
    try {
      const file = path.resolve(requested)
      const stat = await fs.stat(file)
      if (stat.isDirectory()) return { ok: false, reason: 'is_directory' }
      const handle = await fs.open(file, constants.O_RDONLY)
      this.reads.set(id, { handle, hash: createHash('sha256') })
      return { ok: true, name: path.basename(file), size: stat.size }
    } catch (error) {
      return { ok: false, reason: rejectReason(error) }
    }
  }

  /** El siguiente trozo (hasta 64 KB), o null al final. */
  async read(id: number): Promise<Uint8Array | null> {
    const open = this.reads.get(id)
    if (!open) return null
    const buffer = Buffer.alloc(CHUNK_BYTES)
    const { bytesRead } = await open.handle.read(buffer, 0, CHUNK_BYTES, null)
    if (bytesRead === 0) return null
    const chunk = buffer.subarray(0, bytesRead)
    open.hash.update(chunk)
    return new Uint8Array(chunk)
  }

  /** Cierra la lectura y da el SHA-256 de lo leído (null si no estaba abierta). */
  async close(id: number): Promise<string | null> {
    const open = this.reads.get(id)
    if (!open) return null
    this.reads.delete(id)
    await open.handle.close().catch(() => undefined)
    return open.hash.digest('hex')
  }

  /** Al terminar la sesión: se borran los envíos a medias y se cierran las lecturas. */
  async dispose(): Promise<void> {
    await Promise.all([...this.uploads.keys()].map((id) => this.cancel(id)))
    await Promise.all([...this.reads.keys()].map((id) => this.close(id)))
  }
}

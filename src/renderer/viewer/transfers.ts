// Ficheros y portapapeles en la ventana de visor (add-remote-desktop D9/D11, tarea 6.5).
//   - Envío al PC (arrastrando o con el botón): en cola, leyendo cada fichero por trozos con su SHA-256.
//   - Descarga del PC: el proceso principal pregunta dónde guardar y escribe; aquí se piden los trozos.
//   - Portapapeles en los dos sentidos, con pausa (en pausa no se envía ni se recibe nada).
import type { FsListing } from '../../shared/remote/hostBridge'
import { Sha256 } from '../../shared/remote/sha256'
import {
  BUFFER_HIGH_BYTES,
  CHUNK_BYTES,
  ClipboardAssembler,
  ClipboardContent,
  ClipboardPiece,
  decodeChunk,
  encodeChunk,
  parseTransferMessage,
  splitClipboard,
  TransferMessage
} from '../../shared/remote/transfer'
import type { AbsorViewerApi } from '../../shared/remote/viewerBridge'
import { ChannelLike, room } from '../host/transfers'

export type TransferStatus = 'waiting' | 'running' | 'done' | 'failed' | 'cancelled'

/** Lo que muestra la lista de transferencias. */
export interface TransferView {
  id: number
  direction: 'up' | 'down'
  name: string
  size: number
  bytes: number
  status: TransferStatus
  /** Al terminar: el nombre con el que quedó en el PC (envío) o la ruta local (descarga). */
  result?: string
  /** Código del fallo (texts.ts). */
  error?: string
}

type Bridge = Pick<
  AbsorViewerApi,
  'clipboardWatch' | 'clipboardWrite' | 'saveBegin' | 'saveChunk' | 'saveFinish' | 'saveCancel'
>

export interface ViewerTransfersOptions {
  bridge: Bridge
  control: () => ChannelLike | null
  onChange: (transfer: TransferView) => void
}

/** Cada cuánto se avisa del progreso de una transferencia como mucho. */
const PROGRESS_MS = 150

export class ViewerTransfers {
  private channel: ChannelLike | null = null
  private nextId = 1
  private readonly views = new Map<number, TransferView>()
  private readonly waiters = new Map<
    number,
    { types: TransferMessage['type'][]; resolve: (message: TransferMessage | null) => void }
  >()
  /** Descargas que aceptan trozos. */
  private readonly receiving = new Set<number>()
  private readonly lastEmit = new Map<number, number>()
  private uploads: Promise<void> = Promise.resolve()
  private readonly assembler = new ClipboardAssembler()
  private clipboardId = 0
  private clipboardEnabled = false
  private paused = false

  constructor(private readonly options: ViewerTransfersOptions) {}

  attach(channel: ChannelLike): void {
    this.channel = channel
    channel.binaryType = 'arraybuffer'
    channel.bufferedAmountLowThreshold = BUFFER_HIGH_BYTES
    channel.onmessage = (event) => this.onMessage(event.data)
  }

  /** Se perdió la conexión: lo que estaba en marcha falla (al reconectar no se reanuda). */
  detach(): void {
    this.channel = null
    for (const view of this.views.values()) {
      if (view.status === 'waiting' || view.status === 'running') {
        if (view.direction === 'down') this.options.bridge.saveCancel(view.id)
        this.update(view, { status: 'failed', error: 'connection_lost' }, true)
      }
    }
    this.receiving.clear()
    for (const waiter of this.waiters.values()) waiter.resolve(null)
    this.waiters.clear()
  }

  // --- Portapapeles ------------------------------------------------------------------------

  /** El PC permite (o no) el portapapeles en esta sesión. */
  setClipboardEnabled(enabled: boolean): void {
    this.clipboardEnabled = enabled
    void this.options.bridge.clipboardWatch(enabled && !this.paused)
  }

  get clipboardPaused(): boolean {
    return this.paused
  }

  setClipboardPaused(paused: boolean): void {
    this.paused = paused
    void this.options.bridge.clipboardWatch(this.clipboardEnabled && !paused)
  }

  /** Trozo del portapapeles del PC (canal `control`). */
  onClipboardPiece(piece: ClipboardPiece): void {
    if (!this.clipboardEnabled || this.paused) return
    const content = this.assembler.add(piece)
    if (content) this.options.bridge.clipboardWrite(content)
  }

  /** Lo copiado en este equipo: al PC, en trozos. */
  async sendClipboard(content: ClipboardContent): Promise<void> {
    const control = this.options.control()
    if (!control || !this.clipboardEnabled || this.paused) return
    for (const piece of splitClipboard(++this.clipboardId, content)) {
      await room(control)
      if (control.readyState !== 'open') return
      control.send(JSON.stringify(piece))
    }
  }

  // --- Ficheros ----------------------------------------------------------------------------

  /** Envía ficheros al PC, uno detrás de otro. */
  upload(files: File[]): void {
    for (const file of files) {
      const view = this.add('up', file.name || 'fichero', file.size)
      this.uploads = this.uploads.then(() => this.sendFile(view, file))
    }
  }

  /** Descarga un fichero del PC (antes pregunta dónde guardarlo). */
  download(path: string, name: string, size: number): void {
    void this.receiveFile(this.add('down', name, size), path)
  }

  cancel(id: number): void {
    const view = this.views.get(id)
    if (!view || (view.status !== 'waiting' && view.status !== 'running')) return
    this.update(view, { status: 'cancelled' }, true)
    this.send({ type: 'file-cancel', id })
    if (view.direction === 'down') {
      this.receiving.delete(id)
      this.options.bridge.saveCancel(id)
    }
    this.waiters.get(id)?.resolve(null)
  }

  /** Contenido de una carpeta del PC ('' es la carpeta del usuario); null si se perdió la conexión. */
  async list(path: string): Promise<FsListing | null> {
    const id = this.nextId++
    this.send({ type: 'fs-list', id, path })
    const reply = await this.wait(id, ['fs-entries'])
    if (!reply || reply.type !== 'fs-entries') return null
    const { path: listed, parent, entries, truncated, error } = reply
    return { path: listed, parent, entries, truncated, error }
  }

  private async sendFile(view: TransferView, file: File): Promise<void> {
    const channel = this.channel
    if (view.status === 'cancelled') return
    if (!channel) return this.update(view, { status: 'failed', error: 'connection_lost' }, true)
    this.update(view, { status: 'running' }, true)
    this.send({ type: 'file-offer', id: view.id, name: view.name.slice(0, 255), size: view.size })
    const reply = await this.wait(view.id, ['file-accept', 'file-reject'])
    if (!reply) return
    if (reply.type === 'file-reject')
      return this.update(view, { status: 'failed', error: reply.reason }, true)

    const hash = new Sha256()
    const reader = file.stream().getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        for (let offset = 0; offset < value.length; offset += CHUNK_BYTES) {
          if (view.status !== 'running') return
          const part = value.subarray(offset, offset + CHUNK_BYTES)
          hash.update(part)
          await room(channel)
          if (channel.readyState !== 'open' || this.channel !== channel) {
            return this.update(view, { status: 'failed', error: 'connection_lost' }, true)
          }
          channel.send(encodeChunk(view.id, part))
          this.update(view, { bytes: view.bytes + part.length })
        }
      }
    } catch {
      this.send({ type: 'file-cancel', id: view.id })
      return this.update(view, { status: 'failed', error: 'read' }, true)
    } finally {
      void reader.cancel().catch(() => undefined)
    }
    this.send({ type: 'file-end', id: view.id, sha256: hash.hex() })
    const result = await this.wait(view.id, ['file-done', 'file-error'])
    if (!result) return
    if (result.type === 'file-done')
      this.update(view, { status: 'done', result: result.name }, true)
    else if (result.type === 'file-error')
      this.update(view, { status: 'failed', error: result.reason }, true)
  }

  private async receiveFile(view: TransferView, path: string): Promise<void> {
    const { bridge } = this.options
    const begin = await bridge.saveBegin(view.id, view.name, view.size)
    if (!begin.ok) {
      // Cancelado en el diálogo: no se pide nada al PC
      return this.update(
        view,
        begin.reason === 'cancelled' ? { status: 'cancelled' } : { status: 'failed', error: 'io' },
        true
      )
    }
    if (view.status === 'cancelled') return bridge.saveCancel(view.id)
    this.receiving.add(view.id)
    this.update(view, { status: 'running' }, true)
    this.send({ type: 'file-request', id: view.id, path })
    const start = await this.wait(view.id, ['file-start', 'file-reject'])
    if (!start) return
    if (start.type === 'file-reject' || (start.type === 'file-start' && start.size !== view.size)) {
      this.receiving.delete(view.id)
      bridge.saveCancel(view.id)
      if (start.type === 'file-start') this.send({ type: 'file-cancel', id: view.id })
      return this.update(
        view,
        { status: 'failed', error: start.type === 'file-reject' ? start.reason : 'size' },
        true
      )
    }
    const end = await this.wait(view.id, ['file-end'])
    this.receiving.delete(view.id)
    if (!end || end.type !== 'file-end') return
    const result = await bridge.saveFinish(view.id, end.sha256)
    this.update(
      view,
      result.ok
        ? { status: 'done', result: result.path }
        : { status: 'failed', error: result.reason },
      true
    )
  }

  // --- Canal ---------------------------------------------------------------------------------

  private add(direction: 'up' | 'down', name: string, size: number): TransferView {
    const view: TransferView = {
      id: this.nextId++,
      direction,
      name,
      size,
      bytes: 0,
      status: 'waiting'
    }
    this.views.set(view.id, view)
    this.options.onChange({ ...view })
    return view
  }

  private update(view: TransferView, changes: Partial<TransferView>, now = false): void {
    Object.assign(view, changes)
    const last = this.lastEmit.get(view.id) ?? 0
    if (!now && Date.now() - last < PROGRESS_MS) return
    this.lastEmit.set(view.id, Date.now())
    this.options.onChange({ ...view })
  }

  private send(message: TransferMessage): void {
    if (this.channel?.readyState === 'open') this.channel.send(JSON.stringify(message))
  }

  private wait(id: number, types: TransferMessage['type'][]): Promise<TransferMessage | null> {
    return new Promise((resolve) => {
      this.waiters.set(id, {
        types,
        resolve: (message) => {
          this.waiters.delete(id)
          resolve(message)
        }
      })
    })
  }

  private onMessage(data: unknown): void {
    if (typeof data === 'string') {
      const message = parseTransferMessage(data)
      const waiter = message ? this.waiters.get(message.id) : undefined
      if (message && waiter?.types.includes(message.type)) waiter.resolve(message)
      return
    }
    const frame =
      data instanceof ArrayBuffer ? data : ArrayBuffer.isView(data) ? (data as Uint8Array) : null
    const chunk = frame ? decodeChunk(frame) : null
    const view = chunk ? this.views.get(chunk.id) : undefined
    if (!chunk || !view || !this.receiving.has(chunk.id)) return
    this.options.bridge.saveChunk(chunk.id, chunk.data)
    this.update(view, { bytes: view.bytes + chunk.data.length })
  }
}

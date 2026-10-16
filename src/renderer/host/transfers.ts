// Ficheros y portapapeles en la ventana `host` del PC controlado (add-remote-desktop D9, tarea 6.3).
// Esta ventana solo hace de puente: el disco y el portapapeles los toca el proceso principal, que lo
// vuelve a comprobar todo. Antes de autenticar se descarta lo que llegue.
import type { AbsorHostApi, FsListing } from '../../shared/remote/hostBridge'
import {
  BUFFER_HIGH_BYTES,
  ClipboardAssembler,
  ClipboardContent,
  ClipboardPiece,
  decodeChunk,
  encodeChunk,
  parseTransferMessage,
  splitClipboard,
  TransferMessage
} from '../../shared/remote/transfer'

/** Lo que se usa de un RTCDataChannel (para poder probarlo sin WebRTC). */
export interface ChannelLike {
  readonly readyState: string
  readonly bufferedAmount: number
  bufferedAmountLowThreshold: number
  binaryType: string
  send(data: string | Uint8Array): void
  onmessage: ((event: MessageEvent) => void) | null
  onbufferedamountlow: ((event: Event) => void) | null
}

type HostApi = Pick<
  AbsorHostApi,
  | 'clipboardWrite'
  | 'fileBegin'
  | 'fileChunk'
  | 'fileFinish'
  | 'fileCancel'
  | 'fsList'
  | 'fileOpen'
  | 'fileRead'
  | 'fileClose'
>

export interface HostTransfersOptions {
  host: HostApi
  authenticated: () => boolean
  features: () => { clipboard: boolean; files: boolean }
  control: () => ChannelLike | null
}

/** Espera a que el canal tenga sitio (o se cierre). */
export function room(channel: ChannelLike): Promise<void> {
  if (channel.bufferedAmount <= BUFFER_HIGH_BYTES || channel.readyState !== 'open') {
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    const check = setInterval(() => {
      if (channel.readyState !== 'open') done()
    }, 500)
    const done = (): void => {
      clearInterval(check)
      channel.onbufferedamountlow = null
      resolve()
    }
    channel.onbufferedamountlow = done
  })
}

export class HostTransfers {
  private channel: ChannelLike | null = null
  /** Envíos al PC en curso: id → nombre anunciado. */
  private readonly uploads = new Map<number, string>()
  /** Descargas desde el PC en curso (cancelar las quita). */
  private readonly downloads = new Set<number>()
  private readonly assembler = new ClipboardAssembler()
  private clipboardId = 0

  constructor(private readonly options: HostTransfersOptions) {}

  attach(channel: ChannelLike): void {
    this.channel = channel
    channel.binaryType = 'arraybuffer'
    channel.bufferedAmountLowThreshold = BUFFER_HIGH_BYTES
    channel.onmessage = (event) => void this.onMessage(event.data)
  }

  /** La conexión se ha cerrado: lo que estaba a medias se cancela. */
  detach(): void {
    for (const id of this.uploads.keys()) this.options.host.fileCancel(id)
    this.uploads.clear()
    this.downloads.clear()
    this.channel = null
  }

  /** Trozo del portapapeles del controlador (canal `control`). */
  onClipboardPiece(piece: ClipboardPiece): void {
    if (!this.options.authenticated() || !this.options.features().clipboard) return
    const content = this.assembler.add(piece)
    if (content) this.options.host.clipboardWrite(content)
  }

  /** Lo copiado en el PC: al controlador, en trozos y con control de presión. */
  async sendClipboard(content: ClipboardContent): Promise<void> {
    const control = this.options.control()
    if (!control || !this.options.authenticated() || !this.options.features().clipboard) return
    for (const piece of splitClipboard(++this.clipboardId, content)) {
      await room(control)
      if (control.readyState !== 'open') return
      control.send(JSON.stringify(piece))
    }
  }

  private send(message: TransferMessage): void {
    if (this.channel?.readyState === 'open') this.channel.send(JSON.stringify(message))
  }

  private async onMessage(data: unknown): Promise<void> {
    if (!this.options.authenticated()) return
    if (typeof data === 'string') {
      const message = parseTransferMessage(data)
      if (message) await this.handle(message)
      return
    }
    const frame =
      data instanceof ArrayBuffer ? data : ArrayBuffer.isView(data) ? (data as Uint8Array) : null
    const chunk = frame ? decodeChunk(frame) : null
    if (chunk && this.uploads.has(chunk.id)) this.options.host.fileChunk(chunk.id, chunk.data)
  }

  private async handle(message: TransferMessage): Promise<void> {
    const { host } = this.options
    const files = this.options.features().files
    switch (message.type) {
      case 'file-offer': {
        if (!files) return this.send({ type: 'file-reject', id: message.id, reason: 'disabled' })
        const result = await host.fileBegin(message.id, message.name, message.size)
        if (!result.ok)
          return this.send({ type: 'file-reject', id: message.id, reason: result.reason })
        this.uploads.set(message.id, message.name)
        return this.send({ type: 'file-accept', id: message.id })
      }
      case 'file-end': {
        const name = this.uploads.get(message.id)
        if (name === undefined) return
        this.uploads.delete(message.id)
        const result = await host.fileFinish(message.id, name, message.sha256)
        return this.send(
          result.ok
            ? { type: 'file-done', id: message.id, name: result.name }
            : { type: 'file-error', id: message.id, reason: result.reason }
        )
      }
      case 'file-cancel':
        if (this.uploads.delete(message.id)) host.fileCancel(message.id)
        this.downloads.delete(message.id)
        return
      case 'fs-list': {
        const listing: FsListing = files
          ? await host.fsList(message.path)
          : { path: message.path, parent: null, entries: [], error: 'disabled' }
        return this.send({ type: 'fs-entries', id: message.id, ...listing })
      }
      case 'file-request':
        if (!files) return this.send({ type: 'file-reject', id: message.id, reason: 'disabled' })
        return this.serve(message.id, message.path)
      default:
        return
    }
  }

  /** Envía un fichero del PC al controlador, trozo a trozo, y al final su resumen. */
  private async serve(id: number, path: string): Promise<void> {
    const { host } = this.options
    if (this.downloads.has(id)) return
    const opened = await host.fileOpen(id, path)
    if (!opened.ok) return this.send({ type: 'file-reject', id, reason: opened.reason })
    this.downloads.add(id)
    this.send({ type: 'file-start', id, name: opened.name, size: opened.size })
    try {
      for (;;) {
        const channel = this.channel
        if (!channel || !this.downloads.has(id)) break
        const chunk = await host.fileRead(id)
        if (!chunk) break
        await room(channel)
        if (!this.downloads.has(id) || channel.readyState !== 'open') break
        channel.send(encodeChunk(id, chunk))
      }
    } finally {
      const sha256 = await host.fileClose(id)
      // Cancelada o sin canal: no hay final que mandar
      if (this.downloads.delete(id) && sha256) this.send({ type: 'file-end', id, sha256 })
    }
  }
}

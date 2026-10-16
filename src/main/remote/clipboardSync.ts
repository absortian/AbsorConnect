// Portapapeles compartido del control remoto (add-remote-desktop D9, tareas 6.3 y 6.5), en los dos
// extremos: el PC controlado y la ventana de visor. Electron no avisa de los cambios del portapapeles,
// así que se mira cada segundo con una huella barata (una imagen no se codifica en PNG hasta que
// cambia), y lo que llega del otro equipo no se reenvía.
import { createHash } from 'crypto'
import { clipboard, nativeImage } from 'electron'
import { ClipboardContent, clipboardFits } from '../../shared/remote/transfer'

const POLL_MS = 1000
/** Cada cuántos bytes del mapa de bits se toma una muestra para la huella. */
const SAMPLE_STEP = 1021

interface ImageLike {
  isEmpty(): boolean
  getSize(): { width: number; height: number }
  toBitmap(): Buffer
  toPNG(): Buffer
}

export interface ClipboardApi {
  readText(): string
  readImage(): ImageLike
  writeText(text: string): void
  writeImagePng(png: Uint8Array): void
}

const electronClipboard: ClipboardApi = {
  readText: () => clipboard.readText(),
  readImage: () => clipboard.readImage(),
  writeText: (text) => clipboard.writeText(text),
  writeImagePng: (png) => clipboard.writeImage(nativeImage.createFromBuffer(Buffer.from(png)))
}

export class ClipboardWatcher {
  private timer: ReturnType<typeof setInterval> | null = null
  private last = ''

  constructor(
    private readonly onChange: (content: ClipboardContent) => void,
    private readonly api: ClipboardApi = electronClipboard
  ) {}

  /** Empieza a vigilar. Lo que ya había copiado no se envía: solo lo que se copie después. */
  start(): void {
    if (this.timer) return
    this.last = this.fingerprint()
    this.timer = setInterval(() => this.poll(), POLL_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  get running(): boolean {
    return this.timer !== null
  }

  /** Pone lo que llega del otro equipo, sin volver a enviarlo. */
  write(content: ClipboardContent): void {
    if (!clipboardFits(content)) return
    if (content.kind === 'text') this.api.writeText(content.text)
    else this.api.writeImagePng(content.png)
    this.last = this.fingerprint()
  }

  private poll(): void {
    let current: string
    try {
      current = this.fingerprint()
    } catch {
      return
    }
    if (current === this.last) return
    this.last = current
    const content = this.read()
    if (content && clipboardFits(content)) this.onChange(content)
  }

  private fingerprint(): string {
    const text = this.api.readText()
    if (text) return `t:${createHash('sha256').update(text).digest('hex')}`
    const image = this.api.readImage()
    if (image.isEmpty()) return ''
    const { width, height } = image.getSize()
    const bitmap = image.toBitmap()
    const sample = Buffer.alloc(Math.ceil(bitmap.length / SAMPLE_STEP))
    for (let i = 0, j = 0; i < bitmap.length; i += SAMPLE_STEP, j++) sample[j] = bitmap[i]
    return `i:${width}x${height}:${createHash('sha256').update(sample).digest('hex')}`
  }

  private read(): ClipboardContent | null {
    const text = this.api.readText()
    if (text) return { kind: 'text', text }
    const image = this.api.readImage()
    return image.isEmpty() ? null : { kind: 'image', png: new Uint8Array(image.toPNG()) }
  }
}

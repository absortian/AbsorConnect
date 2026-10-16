// Sonido del sistema de un PC Linux controlado (add-remote-desktop D8). `audio: 'loopback'` llega
// vacío en Linux, así que mientras dura la sesión una fuente virtual de PulseAudio (o PipeWire con
// su capa de PulseAudio) reenvía el monitor de la salida por defecto, y la ventana `host` la abre
// como una entrada de sonido. Necesita `pactl` (paquete pulseaudio-utils).
import { execFile } from 'child_process'

/** Nombre de la fuente en el servidor de sonido (también sirve para encontrar las que quedaron). */
export const LINUX_AUDIO_SOURCE = 'absor_connect_audio'
/** Nombre visible de la fuente: la ventana `host` la busca por esta etiqueta. */
export const LINUX_AUDIO_LABEL = 'Absor Connect'
/** Cada cuánto se mira si ha cambiado la salida por defecto (p. ej. al conectar unos auriculares). */
const SINK_WATCH_MS = 3000

export type Pactl = (args: string[]) => Promise<string>

/** `pactl` en inglés, para poder leer su salida. */
export const runPactl: Pactl = (args) =>
  new Promise((resolve, reject) =>
    execFile(
      'pactl',
      args,
      { env: { ...process.env, LC_ALL: 'C' }, timeout: 5000, encoding: 'utf8' },
      (error, stdout) => (error ? reject(error) : resolve(stdout))
    )
  )

export class LinuxAudio {
  private module: string | null = null
  private sink: string | null = null
  private watch: ReturnType<typeof setInterval> | null = null
  private onChange: (() => void) | null = null
  private busy: Promise<unknown> = Promise.resolve()

  constructor(private readonly pactl: Pactl = runPactl) {}

  /** Hay `pactl` y un servidor de sonido compatible con PulseAudio. */
  async available(): Promise<boolean> {
    try {
      await this.pactl(['info'])
      return true
    } catch {
      return false
    }
  }

  /** Quita las fuentes que quedaron de una sesión anterior (si la app se cerró de golpe). */
  cleanup(): Promise<void> {
    return this.serial(async () => {
      const modules = await this.pactl(['list', 'short', 'modules']).catch(() => '')
      for (const line of modules.split('\n')) {
        if (line.includes(`source_name=${LINUX_AUDIO_SOURCE}`)) {
          await this.pactl(['unload-module', line.split('\t')[0].trim()]).catch(() => undefined)
        }
      }
    })
  }

  /**
   * Crea la fuente (si no está ya) y vigila la salida por defecto. Devuelve la etiqueta con la que
   * la ventana `host` la encuentra, o null si no se puede. `onChange` avisa cuando la fuente se ha
   * vuelto a crear sobre otra salida: hay que abrirla de nuevo.
   */
  start(onChange: () => void): Promise<string | null> {
    return this.serial(async () => {
      this.onChange = onChange
      if (this.module) return LINUX_AUDIO_LABEL
      if (!(await this.load())) return null
      this.watch = setInterval(() => void this.followDefaultSink(), SINK_WATCH_MS)
      return LINUX_AUDIO_LABEL
    })
  }

  /** Quita la fuente al terminar la sesión. */
  stop(): Promise<void> {
    return this.serial(async () => {
      if (this.watch) clearInterval(this.watch)
      this.watch = null
      this.onChange = null
      await this.unload()
    })
  }

  private async followDefaultSink(): Promise<void> {
    const changed = await this.serial(async () => {
      if (!this.module) return false
      const sink = await this.defaultSink().catch(() => null)
      if (!sink || sink === this.sink) return false
      await this.unload()
      return this.load()
    })
    if (changed) this.onChange?.()
  }

  private async load(): Promise<boolean> {
    try {
      const sink = await this.defaultSink()
      const index = await this.pactl([
        'load-module',
        'module-remap-source',
        `master=${sink}.monitor`,
        `source_name=${LINUX_AUDIO_SOURCE}`,
        // Sin las comillas simples, el servidor corta la descripción en el espacio ("Absor")
        `source_properties='device.description="${LINUX_AUDIO_LABEL}"'`
      ])
      this.module = index.trim()
      this.sink = sink
      return true
    } catch (error) {
      console.error('Remote host: Linux audio source unavailable:', error)
      return false
    }
  }

  private async unload(): Promise<void> {
    if (this.module) await this.pactl(['unload-module', this.module]).catch(() => undefined)
    this.module = null
    this.sink = null
  }

  private async defaultSink(): Promise<string> {
    const sink = (await this.pactl(['get-default-sink']).catch(() => '')).trim()
    if (sink) return sink
    // pactl anterior a la 15: se lee de `pactl info`
    const info = await this.pactl(['info'])
    const found = info.match(/^Default Sink:\s*(\S+)/m)?.[1]
    if (!found) throw new Error('no default sink')
    return found
  }

  /** Una operación con pactl detrás de otra, para no crear dos fuentes a la vez. */
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.busy.then(task, task)
    this.busy = run.catch(() => undefined)
    return run
  }
}

/** La del PC: una sola, porque solo hay una sesión a la vez. */
export const linuxAudio = new LinuxAudio()

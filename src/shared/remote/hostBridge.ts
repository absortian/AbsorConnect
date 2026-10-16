// Puente entre el proceso principal y la ventana oculta `host` del PC controlado (add-remote-desktop
// D7). La ventana hace WebRTC y la captura; el proceso principal decide todo lo demás: K y la
// verificación de la contraseña no salen de él, y la entrada se aplica allí.
import type { AuthResultMessage, DisplayInfo, HelloMessage } from './protocol'
import type {
  ClipboardContent,
  FsEntry,
  TransferErrorReason,
  TransferRejectReason
} from './transfer'

/** Carpeta del PC tal como la ve el controlador (D9, `fs-entries`). */
export interface FsListing {
  path: string
  parent: string | null
  entries: FsEntry[]
  truncated?: boolean
  error?: TransferRejectReason
}

export type FileBeginResult = { ok: true } | { ok: false; reason: TransferRejectReason }
export type FileFinishResult =
  | { ok: true; name: string }
  | { ok: false; reason: TransferErrorReason }
export type FileOpenResult =
  | { ok: true; name: string; size: number }
  | { ok: false; reason: TransferRejectReason }

export interface IceServer {
  urls: string | string[]
  username?: string
  credential?: string
}

export interface HostFeatures {
  clipboard: boolean
  files: boolean
  /** Sonido permitido en Ajustes y posible en este sistema. */
  audio: boolean
}

/** Lo que recibe la ventana al empezar: una sesión, o la conexión local que abre el cortafuegos de Windows. */
export type HostInit =
  | { mode: 'session'; offer: string; iceServers: IceServer[]; features: HostFeatures }
  | { mode: 'loopback' }

/** API que el preload `host` expone como `window.absorHost`. */
export interface AbsorHostApi {
  onStart(callback: (init: HostInit) => void): void
  /** El proceso principal corta la sesión: hay que despedirse del controlador y cerrar. */
  onClose(callback: (reason: string) => void): void
  /** Descripción de sesión completa (con candidatos) para publicarla como respuesta. */
  answer(sdp: string): void
  hello(): Promise<HelloMessage | null>
  auth(proof: string): Promise<AuthResultMessage>
  displays(): Promise<{ displays: DisplayInfo[]; current: string }>
  selectDisplay(id: string): Promise<boolean>
  /** La captura ya se envía: empieza la sesión de verdad (aviso, notificación, registro). */
  captureStarted(): void
  /** Mensaje recibido por los canales `input` o `pointer` (se valida en el proceso principal). */
  input(message: unknown): void
  /** La conexión terminó por su cuenta (el controlador se fue, se perdió la red…). */
  ended(reason: string): void
  /** Latido cada 2 s: sin él, el proceso principal da la ventana por colgada y cierra la sesión. */
  alive(): void
  /**
   * En Linux, crea la fuente virtual con el sonido del sistema y devuelve su etiqueta para abrirla
   * con getUserMedia (D8). null si el sonido va por `loopback` (Windows y macOS) o no se puede.
   */
  audioSource(): Promise<string | null>
  /** La fuente de sonido se ha vuelto a crear (cambió la salida por defecto): hay que reabrirla. */
  onAudioChanged(callback: () => void): void
  /** Se ha copiado algo en el PC (con el portapapeles compartido permitido). */
  onClipboard(callback: (content: ClipboardContent) => void): void
  /** Pone en el portapapeles del PC lo copiado en el controlador. */
  clipboardWrite(content: ClipboardContent): void
  /** Ficheros que llegan al PC: se escriben en `Descargas/Absor Connect` (D9). */
  fileBegin(id: number, name: string, size: number): Promise<FileBeginResult>
  fileChunk(id: number, chunk: Uint8Array): void
  fileFinish(id: number, name: string, sha256: string): Promise<FileFinishResult>
  fileCancel(id: number): void
  /** Carpetas y ficheros del PC para descargarlos. */
  fsList(path: string): Promise<FsListing>
  fileOpen(id: number, path: string): Promise<FileOpenResult>
  /** El siguiente trozo, o null al final. */
  fileRead(id: number): Promise<Uint8Array | null>
  /** Cierra la lectura y da el SHA-256 de lo leído. */
  fileClose(id: number): Promise<string | null>
  log(message: string): void
}

export const HOST_IPC = {
  start: 'remote-host:start',
  close: 'remote-host:close',
  answer: 'remote-host:answer',
  hello: 'remote-host:hello',
  auth: 'remote-host:auth',
  displays: 'remote-host:displays',
  selectDisplay: 'remote-host:select-display',
  captureStarted: 'remote-host:capture-started',
  input: 'remote-host:input',
  ended: 'remote-host:ended',
  alive: 'remote-host:alive',
  audioSource: 'remote-host:audio-source',
  audioChanged: 'remote-host:audio-changed',
  clipboard: 'remote-host:clipboard',
  clipboardWrite: 'remote-host:clipboard-write',
  fileBegin: 'remote-host:file-begin',
  fileChunk: 'remote-host:file-chunk',
  fileFinish: 'remote-host:file-finish',
  fileCancel: 'remote-host:file-cancel',
  fsList: 'remote-host:fs-list',
  fileOpen: 'remote-host:file-open',
  fileRead: 'remote-host:file-read',
  fileClose: 'remote-host:file-close',
  log: 'remote-host:log'
} as const

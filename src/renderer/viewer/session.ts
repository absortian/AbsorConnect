// Sesión del visor con un PC (add-remote-desktop D3/D6/D9/D11). Hace la oferta completa (vanilla ICE)
// con transceptores recvonly y los canales, la publica a través del proceso principal y espera la
// respuesta; luego responde al `hello` con la prueba de la contraseña. K (nunca la contraseña) se
// queda en memoria mientras dure la ventana, para reconectar sin volver a pedirla.
import { computeProof, sdpFingerprint } from '../../shared/remote/auth'
import type { AbsorViewerApi } from '../../shared/remote/viewerBridge'
import {
  CHANNELS,
  DisplayInfo,
  FeaturesMessage,
  PROTOCOL_VERSION
} from '../../shared/remote/protocol'

export type Phase =
  | 'idle'
  | 'connecting'
  | 'waiting'
  | 'authenticating'
  | 'connected'
  | 'reconnecting'
  | 'failed'
  | 'closed'

export interface Stats {
  route: 'direct' | 'relay' | null
  rttMs: number | null
  fps: number | null
}

export interface SessionEvents {
  phase(phase: Phase, detail?: { code?: string; retryAfter?: number; reason?: string }): void
  video(stream: MediaStream): void
  audio(stream: MediaStream): void
  displays(displays: DisplayInfo[], current: string): void
  features(features: Omit<FeaturesMessage, 'v' | 'type'>): void
  stats(stats: Stats): void
}

/** Error con el código que la interfaz traduce (texts.ts). */
export class SessionError extends Error {
  constructor(
    readonly code: string,
    readonly retryAfter?: number
  ) {
    super(code)
  }
}

const ICE_GATHERING_TIMEOUT_MS = 4000
const POLL_INTERVAL_MS = 1000
const POLL_TIMEOUT_MS = 60_000
/** Con confirmación local en el PC, la respuesta puede tardar 30 s. */
const AUTH_TIMEOUT_MS = 45_000
/** Desconectada más de 5 s: se repite la negociación con la misma K (D3). */
const DISCONNECTED_GRACE_MS = 5_000
const RECONNECT_WINDOW_MS = 30_000
const RECONNECT_PAUSE_MS = 2_000
/** Fallos que no se arreglan reintentando: se paran los reintentos y se muestran. */
const FINAL_ERRORS = new Set([
  'wrong_password',
  'locked',
  'remote_disabled',
  'missing_permissions',
  'unsupported',
  'declined',
  'device_not_found'
])

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function deriveKey(password: string, salt: string, iterations: number): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password.normalize('NFC')),
    'PBKDF2',
    false,
    ['deriveBits']
  )
  const saltBytes = Uint8Array.from(atob(salt), (c) => c.charCodeAt(0))
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations },
    material,
    256
  )
  return new Uint8Array(bits)
}

export class ViewerSession {
  private key: Uint8Array | null = null
  private pc: RTCPeerConnection | null = null
  private control: RTCDataChannel | null = null
  private input: RTCDataChannel | null = null
  private pointer: RTCDataChannel | null = null
  private statsTimer: ReturnType<typeof setInterval> | null = null
  private disconnectedTimer: ReturnType<typeof setTimeout> | null = null
  private closed = false
  private recovering = false
  private framesDecoded: { at: number; frames: number } | null = null

  constructor(
    private readonly bridge: AbsorViewerApi,
    private readonly events: SessionEvents
  ) {}

  get hasKey(): boolean {
    return this.key !== null
  }

  get connected(): boolean {
    return this.control?.readyState === 'open' && this.pc?.connectionState === 'connected'
  }

  /** Conecta con la contraseña (primera vez) o con K (reconectar). */
  async connect(password?: string): Promise<void> {
    this.closed = false
    this.events.phase('connecting')
    try {
      await this.attempt(password)
      this.events.phase('connected')
    } catch (error) {
      const failure = error instanceof SessionError ? error : new SessionError('connection_failed')
      if (failure.code === 'wrong_password') this.key = null
      this.teardown()
      this.events.phase('failed', { code: failure.code, retryAfter: failure.retryAfter })
    }
  }

  sendInput(message: Record<string, unknown>): void {
    if (this.input?.readyState === 'open') {
      this.input.send(JSON.stringify({ v: PROTOCOL_VERSION, ...message }))
    }
  }

  sendPointer(x: number, y: number): void {
    if (this.pointer?.readyState === 'open') {
      this.pointer.send(JSON.stringify({ v: PROTOCOL_VERSION, type: 'move', x, y }))
    }
  }

  selectDisplay(id: string): void {
    this.sendControl({ v: PROTOCOL_VERSION, type: 'select-display', id })
  }

  /** Cierra la sesión (Desconectar o cerrar la ventana): se despide del PC. */
  close(): void {
    this.closed = true
    this.sendControl({ v: PROTOCOL_VERSION, type: 'bye', reason: 'closed' })
    setTimeout(() => this.teardown(), 200)
  }

  /** Pasos de la conexión; mientras se reconecta se sigue mostrando "Reconectando". */
  private progress(phase: Phase): void {
    if (!this.recovering) this.events.phase(phase)
  }

  private sendControl(message: object): void {
    if (this.control?.readyState === 'open') this.control.send(JSON.stringify(message))
  }

  private async attempt(password?: string): Promise<void> {
    this.teardown()
    const pc = new RTCPeerConnection({ iceServers: await this.bridge.iceServers() })
    this.pc = pc
    pc.addTransceiver('video', { direction: 'recvonly' })
    pc.addTransceiver('audio', { direction: 'recvonly' })
    const control = pc.createDataChannel(CHANNELS.control)
    this.control = control
    this.input = pc.createDataChannel(CHANNELS.input)
    // Solo importa la última posición: sin orden ni reenvíos (D9)
    this.pointer = pc.createDataChannel(CHANNELS.pointer, { ordered: false, maxRetransmits: 0 })
    pc.ontrack = ({ track, streams }) => {
      const stream = streams[0] ?? new MediaStream([track])
      if (track.kind === 'video') this.events.video(stream)
      else this.events.audio(stream)
    }

    await pc.setLocalDescription(await pc.createOffer())
    await this.iceGatheringComplete(pc)
    const offer = pc.localDescription!.sdp

    const created = await this.bridge.request(offer)
    if (!created.ok) throw new SessionError(created.code, created.retryAfter)
    this.progress('waiting')
    const answer = await this.waitForAnswer(created.id)
    await pc.setRemoteDescription({ type: 'answer', sdp: answer })
    this.progress('authenticating')
    await this.authenticate(pc, control, offer, answer, password)
    this.watch(pc, control)
  }

  private iceGatheringComplete(pc: RTCPeerConnection): Promise<void> {
    if (pc.iceGatheringState === 'complete') return Promise.resolve()
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ICE_GATHERING_TIMEOUT_MS)
      pc.addEventListener('icegatheringstatechange', () => {
        if (pc.iceGatheringState !== 'complete') return
        clearTimeout(timer)
        resolve()
      })
    })
  }

  private async waitForAnswer(requestId: string): Promise<string> {
    const deadline = Date.now() + POLL_TIMEOUT_MS
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS)
      const result = await this.bridge.poll(requestId)
      if (result.status === 'answered') return result.answer
      if (result.status === 'rejected') throw new SessionError(result.reason, result.retryAfter)
      if (result.status === 'error') {
        throw new SessionError(result.code === 'remote_request_expired' ? 'no_answer' : result.code)
      }
    }
    throw new SessionError('no_answer')
  }

  /** `hello` → prueba con K → `auth-result`. Los mensajes posteriores los atiende `watch`. */
  private authenticate(
    pc: RTCPeerConnection,
    control: RTCDataChannel,
    offer: string,
    answer: string,
    password?: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new SessionError('connection_failed')), AUTH_TIMEOUT_MS)
      const fail = (code: string, retryAfter?: number): void => {
        clearTimeout(timer)
        reject(new SessionError(code, retryAfter))
      }
      pc.addEventListener('connectionstatechange', () => {
        if (pc.connectionState === 'failed') fail('connection_failed')
      })
      control.onclose = () => fail('connection_failed')
      control.onmessage = async (event) => {
        let message: Record<string, unknown>
        try {
          message = JSON.parse(String(event.data))
        } catch {
          return
        }
        if (message.type === 'hello') {
          try {
            if (!this.key) {
              if (!password) return fail('wrong_password')
              this.key = await deriveKey(password, String(message.salt), Number(message.iterations))
            }
            const proof = await computeProof(this.key, {
              nonce: String(message.nonce),
              offerFingerprint: sdpFingerprint(offer) ?? '',
              answerFingerprint: sdpFingerprint(answer) ?? ''
            })
            control.send(JSON.stringify({ v: PROTOCOL_VERSION, type: 'auth', proof }))
          } catch {
            fail('connection_failed')
          }
        } else if (message.type === 'auth-result') {
          clearTimeout(timer)
          if (message.ok === true) resolve()
          else
            reject(
              new SessionError(
                String(message.reason),
                typeof message.retryAfter === 'number' ? message.retryAfter : undefined
              )
            )
        } else if (message.type === 'bye') {
          fail(String(message.reason) === 'wrong_password' ? 'wrong_password' : 'connection_failed')
        }
      }
    })
  }

  /** Con la sesión en marcha: mensajes del PC, caídas de la red y estadísticas. */
  private watch(pc: RTCPeerConnection, control: RTCDataChannel): void {
    control.onmessage = (event) => {
      let message: Record<string, unknown>
      try {
        message = JSON.parse(String(event.data))
      } catch {
        return
      }
      if (message.type === 'displays' && Array.isArray(message.displays)) {
        this.events.displays(message.displays as DisplayInfo[], String(message.current))
      } else if (message.type === 'features') {
        this.events.features({
          clipboard: message.clipboard === true,
          files: message.files === true,
          audio: message.audio === true
        })
      } else if (message.type === 'bye') {
        // El PC cerró la sesión a propósito: no se reconecta solo
        this.closed = true
        // Con la contraseña nueva, K ya no vale: reconectar con ella sería un intento fallido más
        // (cuenta para el bloqueo), así que se vuelve a pedir la contraseña
        if (message.reason === 'password_changed') this.key = null
        this.teardown()
        this.events.phase('closed', { reason: String(message.reason) })
      }
    }
    control.onclose = () => this.lost(pc)
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState
      if (state === 'failed') this.lost(pc)
      else if (state === 'disconnected') {
        this.disconnectedTimer ??= setTimeout(() => this.lost(pc), DISCONNECTED_GRACE_MS)
      } else if (state === 'connected' && this.disconnectedTimer) {
        clearTimeout(this.disconnectedTimer)
        this.disconnectedTimer = null
      }
    }
    this.statsTimer = setInterval(() => void this.collectStats(pc), 1000)
  }

  /** Se perdió la conexión: se repite la negociación con K durante 30 s, sin pedir la contraseña. */
  private async lost(pc: RTCPeerConnection): Promise<void> {
    if (this.closed || this.recovering || pc !== this.pc) return
    this.recovering = true
    this.teardown()
    this.events.phase('reconnecting')
    const deadline = Date.now() + RECONNECT_WINDOW_MS
    let last: SessionError = new SessionError('reconnect_failed')
    while (!this.closed && Date.now() < deadline) {
      try {
        await this.attempt()
        this.recovering = false
        this.events.phase('connected')
        return
      } catch (error) {
        last = error instanceof SessionError ? error : new SessionError('connection_failed')
        this.teardown()
        if (FINAL_ERRORS.has(last.code)) break
        await sleep(RECONNECT_PAUSE_MS)
      }
    }
    this.recovering = false
    if (this.closed) return
    if (last.code === 'wrong_password') this.key = null
    this.events.phase('failed', {
      code: FINAL_ERRORS.has(last.code) ? last.code : 'reconnect_failed',
      retryAfter: last.retryAfter
    })
  }

  private async collectStats(pc: RTCPeerConnection): Promise<void> {
    if (pc !== this.pc) return
    const report = await pc.getStats()
    let pair: RTCIceCandidatePairStats | undefined
    let fps: number | null = null
    report.forEach((entry) => {
      if (entry.type === 'transport' && entry.selectedCandidatePairId) {
        pair = report.get(entry.selectedCandidatePairId)
      }
      if (entry.type === 'inbound-rtp' && entry.kind === 'video') {
        const now = performance.now()
        if (typeof entry.framesPerSecond === 'number') fps = entry.framesPerSecond
        else if (typeof entry.framesDecoded === 'number') {
          // Sin framesPerSecond: se calcula con los decodificados desde la última vez
          if (this.framesDecoded) {
            fps =
              ((entry.framesDecoded - this.framesDecoded.frames) * 1000) /
              (now - this.framesDecoded.at)
          }
          this.framesDecoded = { at: now, frames: entry.framesDecoded }
        }
      }
    })
    const local = pair ? report.get(pair.localCandidateId) : undefined
    const remote = pair ? report.get(pair.remoteCandidateId) : undefined
    const relayed = local?.candidateType === 'relay' || remote?.candidateType === 'relay'
    this.events.stats({
      route: pair ? (relayed ? 'relay' : 'direct') : null,
      rttMs:
        typeof pair?.currentRoundTripTime === 'number'
          ? Math.round(pair.currentRoundTripTime * 1000)
          : null,
      fps: fps === null ? null : Math.round(fps)
    })
  }

  private teardown(): void {
    if (this.statsTimer) clearInterval(this.statsTimer)
    this.statsTimer = null
    if (this.disconnectedTimer) clearTimeout(this.disconnectedTimer)
    this.disconnectedTimer = null
    this.framesDecoded = null
    const pc = this.pc
    this.pc = null
    this.control = null
    this.input = null
    this.pointer = null
    pc?.close()
  }
}

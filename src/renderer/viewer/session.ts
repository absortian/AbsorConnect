// Sesión del visor con un PC (add-remote-desktop D3/D6/D9/D11). Hace la oferta completa (vanilla ICE)
// con transceptores recvonly y los canales, la publica a través del proceso principal y espera la
// respuesta; luego responde al `hello` con la prueba de la contraseña. K (nunca la contraseña) se
// queda en memoria mientras dure la ventana, para reconectar sin volver a pedirla.
import {
  HostActions,
  type HostActionState,
  type HostActionResult
} from '../../shared/remote/hostActions'
import { parseAgentHostMessage, type AgentAction } from '../../shared/remote/agentProtocol'
import { AgentViewerState, type AgentViewerStatus } from '../../shared/remote/agentViewerState'
import { computeProof, sdpFingerprint } from '../../shared/remote/auth'
import type { AbsorViewerApi } from '../../shared/remote/viewerBridge'
import {
  CHANNELS,
  DisplayInfo,
  FeaturesMessage,
  PROTOCOL_VERSION,
  isStreamProfile,
  StreamProfile
} from '../../shared/remote/protocol'
import { ClipboardPiece, parseClipboardPiece } from '../../shared/remote/transfer'
import { VideoStats, VideoStatsSampler, emptyVideoStats } from './videoStats'

export type Phase =
  | 'idle'
  | 'connecting'
  | 'waiting'
  | 'authenticating'
  | 'connected'
  | 'reconnecting'
  | 'failed'
  | 'closed'

export type Stats = VideoStats

export interface SessionEvents {
  phase(phase: Phase, detail?: { code?: string; retryAfter?: number; reason?: string }): void
  video(stream: MediaStream): void
  audio(stream: MediaStream): void
  displays(displays: DisplayInfo[], current: string): void
  features(features: Omit<FeaturesMessage, 'v' | 'type'>): void
  quality?(profile: StreamProfile): void
  agentContext?(status: AgentViewerStatus): void
  agentOperations?(state: HostActionState): void
  stats(stats: Stats): void
  /** Canal de ficheros de la conexión en marcha, o null cuando se cierra (D9). */
  fileChannel(channel: RTCDataChannel | null): void
  /** Trozo del portapapeles del PC. */
  clipboard(piece: ClipboardPiece): void
}

export interface SessionOptions {
  /** Solo candidatos de relé (TURN), para probar la conexión por relé. */
  forceRelay?: boolean
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
  private file: RTCDataChannel | null = null
  private statsTimer: ReturnType<typeof setInterval> | null = null
  private disconnectedTimer: ReturnType<typeof setTimeout> | null = null
  private closed = false
  private recovering = false
  private readonly statsSampler = new VideoStatsSampler()
  private readonly statsPending = new Set<RTCPeerConnection>()
  private qualitySupported = false
  private authenticated = false
  private agentState = new AgentViewerState()
  private declaredFeatures = { clipboard: false, files: false, audio: false, streamQuality: false }
  private readonly audioTracks = new Set<MediaStreamTrack>()
  private readonly agentActions = new HostActions({
    active: () =>
      this.authenticated &&
      !this.closed &&
      this.agentState.status.enabled &&
      this.agentState.status.sequence > 0 &&
      this.control?.readyState === 'open',
    send: (message) => this.sendControl(message),
    changed: (state) => this.events.agentOperations?.(state)
  })
  get operationState(): HostActionState {
    return this.agentActions.state
  }
  performOperation(
    action: AgentAction,
    confirm: () => Promise<boolean>
  ): Promise<HostActionResult> {
    return this.agentActions.run(action, confirm)
  }
  private desiredProfile: StreamProfile | null = null

  constructor(
    private readonly bridge: AbsorViewerApi,
    private readonly events: SessionEvents,
    private readonly options: SessionOptions = {}
  ) {}

  /** Canal `control` de la conexión en marcha (el portapapeles va por él). */
  get controlChannel(): RTCDataChannel | null {
    return this.control
  }

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
    if (
      !this.closed &&
      this.authenticated &&
      this.agentState.status.inputAllowed &&
      this.input?.readyState === 'open'
    ) {
      this.input.send(JSON.stringify({ v: PROTOCOL_VERSION, ...message }))
    }
  }

  sendPointer(x: number, y: number): void {
    if (
      !this.closed &&
      this.authenticated &&
      this.agentState.status.inputAllowed &&
      this.pointer?.readyState === 'open'
    ) {
      this.pointer.send(JSON.stringify({ v: PROTOCOL_VERSION, type: 'move', x, y }))
    }
  }

  selectDisplay(id: string): void {
    this.sendControl({ v: PROTOCOL_VERSION, type: 'select-display', id })
  }

  selectQuality(profile: StreamProfile): void {
    if (!this.qualitySupported || !this.connected) return
    this.desiredProfile = profile
    this.sendControl({ v: 1, type: 'set-stream-quality', profile })
  }

  /** Cierra la sesión (Desconectar o cerrar la ventana): se despide del PC. */
  close(): void {
    this.releaseInput()
    this.closed = true
    this.sendControl({ v: PROTOCOL_VERSION, type: 'bye', reason: 'closed' })
    const pc = this.pc
    setTimeout(() => {
      if (pc === this.pc) this.teardown()
    }, 200)
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
    const pc = new RTCPeerConnection({
      iceServers: await this.bridge.iceServers(),
      ...(this.options.forceRelay ? { iceTransportPolicy: 'relay' as const } : {})
    })
    this.pc = pc
    pc.addTransceiver('video', { direction: 'recvonly' })
    pc.addTransceiver('audio', { direction: 'recvonly' })
    const control = pc.createDataChannel(CHANNELS.control)
    this.control = control
    this.input = pc.createDataChannel(CHANNELS.input)
    // Solo importa la última posición: sin orden ni reenvíos (D9)
    this.pointer = pc.createDataChannel(CHANNELS.pointer, { ordered: false, maxRetransmits: 0 })
    // Ficheros: fiable y ordenado, mensajes y trozos binarios por el mismo canal (D9)
    this.file = pc.createDataChannel(CHANNELS.file)
    pc.ontrack = ({ track, streams }) => {
      if (pc !== this.pc || this.closed) return
      const stream = streams[0] ?? new MediaStream([track])
      if (track.kind === 'video') this.events.video(stream)
      else {
        if (pc !== this.pc) return
        this.audioTracks.add(track)
        track.enabled = this.agentState.status.sensitiveAllowed && this.declaredFeatures.audio
        this.events.audio(stream)
      }
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
    if (this.file) this.events.fileChannel(this.file)
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
    this.authenticated = true
    control.onmessage = (event) => {
      if (pc !== this.pc || this.closed) return
      let message: Record<string, unknown>
      try {
        message = JSON.parse(String(event.data))
      } catch {
        return
      }
      if (!message || typeof message !== 'object' || Array.isArray(message)) return
      if (message.extension === 1) {
        const parsed = parseAgentHostMessage(String(event.data))
        if (parsed?.type === 'host-operation-result') {
          if (
            this.agentActions.receive(parsed) &&
            parsed.status === 'accepted' &&
            ['restart', 'logout'].includes(parsed.action)
          ) {
            // No recuperar con K una conexión que ha pedido cambiar de arranque/usuario.
            this.key?.fill(0)
            this.key = null
            this.closed = true
            this.releaseInput()
          }
        } else if (this.agentState.accept(String(event.data))) {
          this.agentActions.invalidateConfirmation()
          this.agentActions.setActions(
            this.agentState.status.sequence > 0 ? this.agentState.availableActions : []
          )
          this.releaseInput()
          this.events.agentContext?.(this.agentState.status)
          this.publishFeatures()
        }
        return
      }
      if (message.type === 'displays' && Array.isArray(message.displays)) {
        this.events.displays(message.displays as DisplayInfo[], String(message.current))
      } else if (message.type === 'features') {
        this.qualitySupported = message.v === 1 && message.streamQuality === true
        this.declaredFeatures = {
          clipboard: message.v === 1 && message.clipboard === true,
          files: message.v === 1 && message.files === true,
          audio: message.v === 1 && message.audio === true,
          streamQuality: this.qualitySupported
        }
        if (this.agentState.announce(message.v, message.unattendedControl)) {
          this.releaseInput()
          this.events.agentContext?.(this.agentState.status)
          this.sendControl({ v: 1, extension: 1, type: 'agent-control-enable' })
        }
        this.publishFeatures()
        if (this.qualitySupported && this.desiredProfile) {
          this.sendControl({ v: 1, type: 'set-stream-quality', profile: this.desiredProfile })
        }
      } else if (
        message.v === 1 &&
        message.type === 'stream-quality' &&
        this.qualitySupported &&
        isStreamProfile(message.profile)
      ) {
        this.events.quality?.(message.profile)
      } else if (
        message.type === 'clipboard' &&
        this.agentState.status.sensitiveAllowed &&
        this.declaredFeatures.clipboard
      ) {
        const piece = parseClipboardPiece(message)
        if (piece) this.events.clipboard(piece)
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
    if (pc !== this.pc || this.closed || this.statsPending.has(pc)) return
    this.statsPending.add(pc)
    try {
      const report = await pc.getStats()
      if (pc !== this.pc || this.closed) return
      this.events.stats(this.statsSampler.sample(report))
    } catch {
      // Una consulta fallida no termina la sesión ni reutiliza contadores anteriores.
      if (pc === this.pc && !this.closed) {
        this.statsSampler.reset()
        this.events.stats(emptyVideoStats())
      }
    } finally {
      this.statsPending.delete(pc)
    }
  }

  releaseInput(): void {
    if (this.authenticated && this.input?.readyState === 'open')
      this.input.send(JSON.stringify({ v: 1, type: 'release-all' }))
  }

  private publishFeatures(): void {
    const sensitive = this.agentState.status.sensitiveAllowed
    for (const track of this.audioTracks) track.enabled = sensitive && this.declaredFeatures.audio
    this.events.features({
      ...this.declaredFeatures,
      clipboard: sensitive && this.declaredFeatures.clipboard,
      files: sensitive && this.declaredFeatures.files,
      audio: sensitive && this.declaredFeatures.audio
    })
  }

  private teardown(): void {
    this.releaseInput()
    this.authenticated = false
    this.agentActions.reset()
    this.agentState = new AgentViewerState()
    for (const track of this.audioTracks) track.enabled = false
    this.audioTracks.clear()
    this.declaredFeatures = { clipboard: false, files: false, audio: false, streamQuality: false }
    this.events.agentContext?.(this.agentState.status)
    if (this.statsTimer) clearInterval(this.statsTimer)
    this.statsTimer = null
    if (this.disconnectedTimer) clearTimeout(this.disconnectedTimer)
    this.disconnectedTimer = null
    this.statsSampler.reset()
    this.qualitySupported = false
    this.events.features({ clipboard: false, files: false, audio: false, streamQuality: false })
    this.events.stats(emptyVideoStats())
    const pc = this.pc
    this.pc = null
    this.control = null
    this.input = null
    this.pointer = null
    if (this.file) {
      this.file = null
      this.events.fileChannel(null)
    }
    pc?.close()
  }
}

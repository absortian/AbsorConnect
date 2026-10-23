// Ventana oculta del PC controlado (add-remote-desktop D3/D7/D9): una por sesión. Responde a la oferta
// del controlador con los transceptores en `sendonly` y SIN pista, y no envía nada hasta que el
// proceso principal verifica la contraseña (D6): entonces captura la pantalla y la pone con
// replaceTrack, sin renegociar. La entrada se reenvía al proceso principal, que la valida y aplica.
import type { HostFeatures, HostInit } from '../../shared/remote/hostBridge'
import {
  CHANNELS,
  HostMessage,
  parseControllerMessage,
  PROTOCOL_VERSION
} from '../../shared/remote/protocol'
import { HostTransfers } from './transfers'
import { HostCapture, videoConstraints } from './capture'
import type { StreamProfile } from '../../shared/remote/protocol'

const host = window.absorHost

/** Como mucho se esperan los candidatos (vanilla ICE: oferta y respuesta completas, D3). */
const ICE_GATHERING_TIMEOUT_MS = 4000
/**
 * Un corte breve lo recupera ICE. Si sigue desconectada 5 s se termina: el controlador repite la
 * negociación con la misma K (D3), y esta sesión no debe dejar el PC "ocupado" mientras tanto.
 */
const DISCONNECTED_GRACE_MS = 5_000

let pc: RTCPeerConnection | null = null
let control: RTCDataChannel | null = null
let features: HostFeatures = { clipboard: false, files: false, audio: false }
let authenticating = false
let authenticated = false
/** Etiqueta de la fuente virtual de sonido en Linux (D8); null si el sonido va por `loopback`. */
let audioLabel: string | null = null
let ending = false
let disconnectedTimer: ReturnType<typeof setTimeout> | null = null
/** Ficheros (canal `file`) y portapapeles (canal `control`), D9. */
const capture = new HostCapture({
  allowed: () => authenticated && !ending && pc !== null,
  acquire: acquireCapture,
  prepare: async (stream) => {
    if (audioLabel && !ending) {
      const track = await openAudioSource(audioLabel)
      if (track) {
        if (ending) track.stop()
        else stream.addTrack(track)
      }
    }
  },
  transceivers: () => pc?.getTransceivers() ?? []
})

const transfers = new HostTransfers({
  host,
  authenticated: () => authenticated,
  features: () => features,
  control: () => control
})

host.onStart((init: HostInit) => {
  if (init.mode === 'loopback') {
    void loopback()
    return
  }
  features = init.features
  host.onAudioChanged(() => {
    void capture.run(reopenAudio).catch((error) => fail('capture_failed', error))
  })
  host.onClipboard((content) => void transfers.sendClipboard(content))
  // Latido para el proceso principal: si esta ventana se cuelga, la sesión se cierra igualmente
  setInterval(() => host.alive(), 2000)
  startSession(init.offer, init.iceServers).catch((error) => fail('ended', error))
})

host.onClose((reason) => end(reason, true))

async function startSession(offer: string, iceServers: RTCIceServer[]): Promise<void> {
  const connection = new RTCPeerConnection({ iceServers })
  pc = connection
  connection.ondatachannel = ({ channel }) => attach(channel)
  connection.onconnectionstatechange = () => onConnectionState(connection.connectionState)

  await connection.setRemoteDescription({ type: 'offer', sdp: offer })
  // Los transceptores de la oferta (recvonly en el controlador) envían desde aquí, sin pista aún
  for (const transceiver of connection.getTransceivers()) transceiver.direction = 'sendonly'
  await connection.setLocalDescription(await connection.createAnswer())
  await iceGatheringComplete(connection)
  host.answer(connection.localDescription!.sdp)
}

function iceGatheringComplete(connection: RTCPeerConnection): Promise<void> {
  if (connection.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ICE_GATHERING_TIMEOUT_MS)
    connection.addEventListener('icegatheringstatechange', () => {
      if (connection.iceGatheringState !== 'complete') return
      clearTimeout(timer)
      resolve()
    })
  })
}

function onConnectionState(state: RTCPeerConnectionState): void {
  if (state === 'failed' || state === 'closed') {
    end('ended')
  } else if (state === 'disconnected') {
    disconnectedTimer ??= setTimeout(() => end('ended'), DISCONNECTED_GRACE_MS)
  } else if (state === 'connected' && disconnectedTimer) {
    clearTimeout(disconnectedTimer)
    disconnectedTimer = null
  }
}

function attach(channel: RTCDataChannel): void {
  switch (channel.label) {
    case CHANNELS.control:
      control = channel
      channel.onmessage = (event) =>
        void onControl(event.data).catch((error) => fail('ended', error))
      channel.onclose = () => end('ended')
      if (channel.readyState === 'open') void sendHello()
      else channel.onopen = () => void sendHello()
      break
    case CHANNELS.input:
    case CHANNELS.pointer:
      // Antes de autenticar se descarta todo (y el proceso principal lo vuelve a comprobar)
      channel.onmessage = (event) => {
        if (!authenticated || ending || typeof event.data !== 'string') return
        try {
          host.input(JSON.parse(event.data))
        } catch {
          // Mensaje mal formado: se ignora
        }
      }
      break
    case CHANNELS.file:
      transfers.attach(channel)
      channel.onclose = () => transfers.detach()
      break
    default:
      // Un canal desconocido no se atiende
      break
  }
}

function send(message: HostMessage): void {
  if (control?.readyState === 'open') control.send(JSON.stringify(message))
}

async function sendHello(): Promise<void> {
  const hello = await host.hello()
  if (!hello) {
    end('expired')
    return
  }
  send(hello)
}

async function onControl(data: unknown): Promise<void> {
  const message = parseControllerMessage(data)
  if (!message || ending) return
  if (message.type === 'bye') {
    end('closed')
    return
  }
  if (!authenticated) {
    // Antes de autenticar solo cuenta `auth`, y una sola vez por conexión
    if (message.type !== 'auth' || authenticating) return
    authenticating = true
    const result = await host.auth(message.proof)
    if (ending) return
    send(result)
    if (!result.ok) {
      setTimeout(() => end(result.reason), 500)
      return
    }
    authenticated = true
    try {
      await capture.run(async () => {
        await capture.replace()
        if (ending) return
        host.captureStarted()
        send({ v: PROTOCOL_VERSION, type: 'features', ...features, streamQuality: true })
        confirmProfile()
        await sendDisplays()
      })
    } catch (error) {
      fail('capture_failed', error)
    }
    return
  }
  if (message.type === 'clipboard') {
    transfers.onClipboardPiece(message)
    return
  }
  if (message.type === 'select-display' || message.type === 'set-stream-quality') {
    try {
      await capture.run(async () => {
        if (message.type === 'select-display') {
          if (!(await host.selectDisplay(message.id)) || ending) return
          await capture.replace()
          if (!ending) await sendDisplays()
        } else {
          await capture.setProfile(message.profile)
        }
        if (!ending) confirmProfile()
      })
    } catch (error) {
      fail('capture_failed', error)
    }
  }
}

function confirmProfile(): void {
  send({ v: PROTOCOL_VERSION, type: 'stream-quality', profile: capture.profile })
}

/** Captura tras autenticar, con el perfil vigente también al cambiar de monitor. */
async function acquireCapture(profile: StreamProfile): Promise<MediaStream> {
  if (features.audio && audioLabel === null) audioLabel = await host.audioSource()
  if (ending) throw new Error('session_closed')
  const next = await navigator.mediaDevices.getDisplayMedia({
    video: videoConstraints(profile),
    audio: features.audio && audioLabel === null
  })
  return next
}

/**
 * Abre la fuente virtual de sonido de Linux, sin los filtros de voz (es el sonido del sistema). La
 * fuente se acaba de crear y Chromium tarda un momento en verla: se reintenta durante 3 s.
 */
async function openAudioSource(label: string): Promise<MediaStreamTrack | null> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const devices = await navigator.mediaDevices.enumerateDevices()
    const device = devices.find((d) => d.kind === 'audioinput' && d.label === label)
    if (device) {
      try {
        const media = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: { exact: device.deviceId },
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false
          }
        })
        return media.getAudioTracks()[0] ?? null
      } catch (error) {
        host.log(`audio source: ${error instanceof Error ? error.message : String(error)}`)
        return null
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  host.log('audio source: not found')
  return null
}

/** La salida por defecto ha cambiado y la fuente se ha vuelto a crear: se cambia la pista. */
async function reopenAudio(): Promise<void> {
  const connection = pc
  const stream = capture.stream
  if (!connection || !stream || !audioLabel) return
  const track = await openAudioSource(audioLabel)
  if (!track) return
  if (ending || capture.stream !== stream) {
    track.stop()
    return
  }
  const sender = connection
    .getTransceivers()
    .find((transceiver) => transceiver.receiver.track.kind === 'audio')?.sender
  try {
    await sender?.replaceTrack(track)
  } catch (error) {
    track.stop()
    throw error
  }
  if (ending) {
    track.stop()
    return
  }
  for (const old of stream.getAudioTracks()) {
    old.stop()
    stream.removeTrack(old)
  }
  stream.addTrack(track)
}

async function sendDisplays(): Promise<void> {
  const { displays, current } = await host.displays()
  if (!ending) send({ v: PROTOCOL_VERSION, type: 'displays', displays, current })
}

function fail(reason: string, error: unknown): void {
  host.log(`${reason}: ${error instanceof Error ? error.message : String(error)}`)
  end(reason)
}

/** Termina: se despide del controlador, para la captura y cierra la conexión. */
function end(reason: string, fromMain = false): void {
  if (ending) return
  ending = true
  authenticated = false
  send({ v: PROTOCOL_VERSION, type: 'bye', reason })
  transfers.detach()
  capture.close()
  setTimeout(() => {
    pc?.close()
    if (!fromMain) host.ended(reason)
  }, 300)
}

/**
 * Conexión WebRTC local entre dos extremos de esta misma ventana. En Windows, la primera vez que la
 * app abre WebRTC el cortafuegos pregunta: así pregunta al activar el control remoto, con alguien
 * delante, y no la primera vez que alguien se conecta a un PC sin nadie (D7).
 */
async function loopback(): Promise<void> {
  const a = new RTCPeerConnection()
  const b = new RTCPeerConnection()
  a.onicecandidate = ({ candidate }) => candidate && void b.addIceCandidate(candidate)
  b.onicecandidate = ({ candidate }) => candidate && void a.addIceCandidate(candidate)
  const opened = new Promise<void>((resolve) => {
    const channel = a.createDataChannel('loopback')
    channel.onopen = () => resolve()
  })
  await a.setLocalDescription(await a.createOffer())
  await b.setRemoteDescription(a.localDescription!)
  await b.setLocalDescription(await b.createAnswer())
  await a.setRemoteDescription(b.localDescription!)
  await Promise.race([opened, new Promise((resolve) => setTimeout(resolve, 5000))])
  a.close()
  b.close()
  host.ended('loopback')
}

// Renderer del controlador de prueba (tarea 4.8): hace lo que hará el visor (tarea 6.5) contra el
// PC controlado de verdad: oferta con transceptores recvonly y los canales, solicitud por la API
// (a través del proceso principal, que tiene el token), K con PBKDF2 de WebCrypto, la prueba de la
// contraseña y la recepción de la imagen.
import { computeProof, sdpFingerprint } from '../../../src/shared/remote/auth'
import { CHANNELS } from '../../../src/shared/remote/protocol'

// Ventana de prueba con nodeIntegration: el IPC llega con require
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ipcRenderer } = require('electron') as typeof import('electron')

interface ScenarioOptions {
  deviceId: string
  password: string
  watchMs?: number
  keepOpen?: boolean
  pointer?: boolean
}

interface Live {
  pc: RTCPeerConnection
  control: RTCDataChannel
  input: RTCDataChannel
  pointer: RTCDataChannel
  events: string[]
  closedAt: number | null
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const video = document.getElementById('video') as HTMLVideoElement
let live: Live | null = null

function iceGatheringComplete(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 4000)
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(timer)
        resolve()
      }
    })
  })
}

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

async function runScenario(options: ScenarioOptions): Promise<unknown> {
  const events: string[] = []
  const iceServers = await ipcRenderer.invoke('api:ice')
  const pc = new RTCPeerConnection({ iceServers })
  pc.addTransceiver('video', { direction: 'recvonly' })
  pc.addTransceiver('audio', { direction: 'recvonly' })
  const control = pc.createDataChannel(CHANNELS.control)
  const input = pc.createDataChannel(CHANNELS.input)
  const pointer = pc.createDataChannel(CHANNELS.pointer, { ordered: false, maxRetransmits: 0 })

  let frames = 0
  let videoSize: { width: number; height: number } | null = null
  pc.ontrack = ({ track }) => {
    if (track.kind !== 'video') return
    video.srcObject = new MediaStream([track])
    void video.play().catch(() => undefined)
    const count = (): void => {
      frames++
      videoSize = { width: video.videoWidth, height: video.videoHeight }
      video.requestVideoFrameCallback(count)
    }
    video.requestVideoFrameCallback(count)
  }

  await pc.setLocalDescription(await pc.createOffer())
  await iceGatheringComplete(pc)
  const offer = pc.localDescription!.sdp
  const created = await ipcRenderer.invoke('api:request', options.deviceId, offer)
  if (created.status !== 201) {
    pc.close()
    return { request: created }
  }
  const outcome = await ipcRenderer.invoke('api:outcome', created.data.id)
  if (outcome.status !== 'answered') {
    pc.close()
    return { outcome }
  }
  const answer: string = outcome.answer
  await pc.setRemoteDescription({ type: 'answer', sdp: answer })

  const state: Live = { pc, control, input, pointer, events, closedAt: null }
  control.onclose = () => (state.closedAt = Date.now())
  const authResult = await new Promise<Record<string, unknown> | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), 45_000)
    control.onmessage = async (event) => {
      const message = JSON.parse(event.data)
      events.push(message.type === 'bye' ? `bye:${message.reason}` : message.type)
      if (message.type === 'hello') {
        const key = await deriveKey(options.password, message.salt, message.iterations)
        const proof = await computeProof(key, {
          nonce: message.nonce,
          offerFingerprint: sdpFingerprint(offer)!,
          answerFingerprint: sdpFingerprint(answer)!
        })
        control.send(JSON.stringify({ v: 1, type: 'auth', proof }))
      } else if (message.type === 'auth-result') {
        clearTimeout(timer)
        resolve(message)
      }
    }
  })

  let pointerAt: unknown = null
  let fps = 0
  if (authResult?.ok) {
    const before = frames
    await sleep(options.watchMs ?? 4000)
    fps = Math.round(((frames - before) * 1000) / (options.watchMs ?? 4000))
    if (options.pointer) {
      pointer.send(JSON.stringify({ v: 1, type: 'move', x: 0.5, y: 0.5 }))
      await sleep(600)
      pointerAt = await ipcRenderer.invoke('pointer:query')
    }
  } else {
    await sleep(1500)
  }

  if (options.keepOpen && authResult?.ok) {
    live = state
  } else {
    if (control.readyState === 'open') control.send(JSON.stringify({ v: 1, type: 'bye', reason: 'closed' }))
    await sleep(300)
    pc.close()
  }
  return {
    outcome: 'answered',
    authResult,
    frames,
    fps,
    videoSize,
    events: [...events],
    pointerAt,
    hostClosed: state.closedAt !== null
  }
}

/** Estado de la sesión que quedó abierta (para ver cómo la corta el PC). */
async function liveState(waitMs = 0): Promise<unknown> {
  await sleep(waitMs)
  if (!live) return null
  return { events: [...live.events], hostClosed: live.closedAt !== null, connection: live.pc.connectionState }
}

/** Clic remoto en una posición normalizada de la pantalla del PC (p. ej. su botón "Desconectar"). */
async function clickAt(x: number, y: number): Promise<void> {
  if (!live) return
  live.pointer.send(JSON.stringify({ v: 1, type: 'move', x, y }))
  await sleep(300)
  live.input.send(JSON.stringify({ v: 1, type: 'button', button: 0, down: true }))
  await sleep(80)
  live.input.send(JSON.stringify({ v: 1, type: 'button', button: 0, down: false }))
}

Object.assign(window, { runScenario, liveState, clickAt })

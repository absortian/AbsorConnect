// Host artificial dentro del mismo Chromium: sin captura, micrófono, red API o secretos reales.
import { computeProof, sdpFingerprint } from '../../../src/shared/remote/auth'
import vectors from '../../../src/shared/remote/auth-vectors.json'
const vector = vectors.vectors.find((v) => v.password)!
const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const canvas = document.createElement('canvas')
canvas.width = 320
canvas.height = 180
const paint = (): void => {
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#186b42'
  ctx.fillRect(0, 0, 320, 180)
  ctx.fillStyle = '#fff'
  ctx.font = '18px sans-serif'
  ctx.fillText('Escritorio artificial de laboratorio', 12, 88)
}
paint()
const paintTimer = setInterval(paint, 100)
let pc: RTCPeerConnection | null = null, control: RTCDataChannel | null = null
let answer = '', offer = '', authenticated = false, enableCount = 0, clipboardWatch = false
let sequence = 1
const send = (value: object): void => control?.send(JSON.stringify(value))
const features = { v: 1, type: 'features', unattendedControl: true, clipboard: true, files: true, audio: true }
const caps = { v: 1, extension: 1, type: 'agent-capabilities', agentVersion: '0.1.0', actions: [], capabilities: { administration: true, login: true, secureAttention: false, restart: false } }
const context = (state: string, imageAvailable: boolean, current = ++sequence): void => {
  send({ v: 1, extension: 1, type: 'agent-context', sequence: current, state, imageAvailable })
}
const ready = async (predicate: () => boolean): Promise<void> => {
  const deadline = performance.now() + 10_000
  while (!predicate()) {
    if (performance.now() > deadline) throw new Error('fixture_timeout')
    await delay(20)
  }
}
// El puente de pruebas no recibe ningún token. El preload real se verifica en sus pruebas propias.
;(window as unknown as { absorViewer: object }).absorViewer = {
  init: async () => ({ deviceId: '12345678-1234-4abc-8def-123456789abc', deviceName: 'Host de laboratorio', language: 'es', theme: 'dark', platform: 'linux', forceRelay: false }),
  iceServers: async () => [],
  request: async (value: string) => {
    offer = value
    pc = new RTCPeerConnection({ iceServers: [] })
    pc.ondatachannel = ({ channel }) => {
      if (channel.label !== 'control') return
      control = channel
      channel.onopen = () => send({ v: 1, type: 'hello', hostName: 'Laboratorio', salt: vector.salt, iterations: vector.iterations, nonce: vector.nonce })
      channel.onmessage = async ({ data }) => {
        const m = JSON.parse(data)
        if (m.type === 'auth') {
          const expected = await computeProof(Uint8Array.from(atob(vector.key!), (c) => c.charCodeAt(0)), { nonce: vector.nonce, offerFingerprint: sdpFingerprint(offer)!, answerFingerprint: sdpFingerprint(answer)! })
          if (m.proof !== expected) throw new Error('fixture_auth_failed')
          authenticated = true
          send({ v: 1, type: 'auth-result', ok: true })
          await delay(20)
          send(features)
          const track = canvas.captureStream(10).getVideoTracks()[0]
          await pc!.getTransceivers().find((t) => t.receiver.track.kind === 'video')!.sender.replaceTrack(track)
        } else if (m.type === 'agent-control-enable' && authenticated) {
          enableCount++
          send(caps)
          context('user_desktop', true, 1)
        } else if (m.type === 'bye') pc?.close()
      }
    }
    await pc.setRemoteDescription({ type: 'offer', sdp: offer })
    pc.getTransceivers().find((t) => t.receiver.track.kind === 'video')!.direction = 'sendonly'
    await pc.setLocalDescription(await pc.createAnswer())
    await ready(() => pc!.iceGatheringState === 'complete')
    answer = pc.localDescription!.sdp
    return { ok: true, id: '12345678-1234-4abc-8def-123456789abc' }
  },
  poll: async () => ({ status: 'answered', answer }),
  clipboardWatch: async (on: boolean) => { clipboardWatch = on },
  onClipboard: () => {}, clipboardWrite: () => {}, saveBegin: async () => ({ ok: false, reason: 'cancelled' }),
  saveChunk: () => {}, saveFinish: async () => ({ ok: false, reason: 'io' }), saveCancel: () => {}, showInFolder: () => {}
}
;(window as unknown as { contextLab: object }).contextLab = {
  connect: async () => {
    await ready(() => document.querySelector<HTMLInputElement>('#password')!.placeholder.length > 0)
    document.querySelector<HTMLInputElement>('#password')!.value = vector.password!
    document.querySelector<HTMLFormElement>('#login')!.requestSubmit()
    await ready(() => authenticated && enableCount === 1 && document.querySelector<HTMLDivElement>('#overlay')!.hidden && document.querySelector<HTMLVideoElement>('#video')!.videoWidth === 320)
    await ready(() => document.querySelector<HTMLVideoElement>('#video')!.style.visibility !== 'hidden')
  },
  context,
  ready,
  features: () => send(features),
  state: () => ({
    authenticated, enableCount, clipboardWatch,
    videoHidden: document.querySelector<HTMLVideoElement>('#video')!.style.visibility === 'hidden',
    state: document.querySelector('#agent-context-state')!.textContent,
    hint: document.querySelector('#agent-context-hint')!.textContent,
    filesHidden: document.querySelector<HTMLButtonElement>('#send-files')!.hidden,
    clipboardHidden: document.querySelector<HTMLButtonElement>('#clipboard')!.hidden,
    soundHidden: document.querySelector<HTMLButtonElement>('#mute')!.hidden,
    shortcutsDisabled: document.querySelector<HTMLButtonElement>('#combos')!.disabled
  }),
  close: () => { clearInterval(paintTimer); pc?.close() }
}

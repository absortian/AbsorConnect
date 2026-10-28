// Host artificial: las acciones solo incrementan contadores; nunca toca el SO o una API externa.
import { computeProof, sdpFingerprint } from '../../../src/shared/remote/auth'
import { parseAgentControllerMessage, type AgentAction } from '../../../src/shared/remote/agentProtocol'
import vectors from '../../../src/shared/remote/auth-vectors.json'
const vector = vectors.vectors.find((v) => v.password)!
const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180
const paint = (): void => { const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#186b42'; ctx.fillRect(0, 0, 320, 180); ctx.fillStyle = 'white'; ctx.font = '18px sans-serif'; ctx.fillText('Host artificial: sin acciones del SO', 8, 88) }
const timer = setInterval(paint, 100); paint()
const peers: RTCPeerConnection[] = [], tracks: MediaStreamTrack[] = []
const nonces = new Set<string>()
const allActions: AgentAction[] = ['lock', 'logout', 'restart', 'secure_attention']
let actions = [...allActions], legacy = false, answer = '', control: RTCDataChannel | null = null
let requests = 0, authentications = 0, operations = 0, presenceQueries = 0, offlineOffers = 0
let reply: 'accepted' | 'rejected' | 'failed' | 'silent' = 'accepted'
let presence = { online: true, available: true, lastSeenAt: '2026-10-28T00:00:00Z' }
let inputKeys = 0, releases = 0
let fatal: string | null = null
const capabilities = (): object => ({ v: 1, extension: 1, type: 'agent-capabilities', agentVersion: '0.1.0', actions, capabilities: { administration: true, login: true, secureAttention: true, restart: true } })
const send = (message: object): void => control?.send(JSON.stringify(message))
const ready = async (predicate: () => boolean, seconds = 20): Promise<void> => {
  const deadline = performance.now() + seconds * 1000
  while (!predicate()) { if (fatal) throw new Error(fatal); if (performance.now() > deadline) throw new Error('actions_fixture_timeout'); await delay(20) }
}
;(window as unknown as { absorViewer: object }).absorViewer = {
  init: async () => ({ deviceId: '12345678-1234-4abc-8def-123456789abc', deviceName: 'Host de laboratorio', language: location.hash === '#en' ? 'en' : 'es', theme: 'dark', platform: 'linux', forceRelay: false }),
  availability: async () => { presenceQueries++; return { ok: true, ...presence } },
  iceServers: async () => [],
  request: async (offer: string) => {
    requests++
    if (!presence.online || !presence.available) { offlineOffers++; return { ok: false, code: 'device_offline' } }
    const peer = new RTCPeerConnection({ iceServers: [] }); peers.push(peer)
    const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    if (nonces.has(nonce)) throw new Error('repeated_nonce'); nonces.add(nonce)
    let localAnswer = '', authenticated = false, negotiated = false
    peer.ondatachannel = ({ channel }) => {
      if (channel.label === 'input') {
        channel.onmessage = ({ data }) => {
          const message = JSON.parse(data)
          if (message.type === 'release-all') releases++
          else if (message.type === 'key' || message.type === 'text') inputKeys++
        }
      }
      if (channel.label !== 'control') return
      control = channel
      channel.onopen = () => channel.send(JSON.stringify({ v: 1, type: 'hello', hostName: 'Laboratorio', salt: vector.salt, iterations: vector.iterations, nonce }))
      channel.onmessage = async ({ data }) => {
        try {
          const message = JSON.parse(data)
          if (message.type === 'auth') {
            if (authenticated) throw new Error('duplicate_auth')
            const expected = await computeProof(Uint8Array.from(atob(vector.key!), (c) => c.charCodeAt(0)), { nonce, offerFingerprint: sdpFingerprint(offer)!, answerFingerprint: sdpFingerprint(localAnswer)! })
            if (message.proof !== expected) throw new Error('actions_fixture_wrong_proof')
            authenticated = true; authentications++
            channel.send(JSON.stringify({ v: 1, type: 'auth-result', ok: true }))
            await delay(20)
            channel.send(JSON.stringify({ v: 1, type: 'features', clipboard: false, files: false, audio: false, ...(legacy ? {} : { unattendedControl: true }) }))
            const track = canvas.captureStream(10).getVideoTracks()[0]; tracks.push(track)
            await peer.getTransceivers().find((t) => t.receiver.track.kind === 'video')!.sender.replaceTrack(track)
          } else if (message.extension === 1) {
            const command = parseAgentControllerMessage(data)
            if (!authenticated || legacy || !command) throw new Error('unauthorized_operation')
            if (command.type === 'agent-control-enable') {
              negotiated = true
              channel.send(JSON.stringify(capabilities()))
              channel.send(JSON.stringify({ v: 1, extension: 1, type: 'agent-context', sequence: 1, state: 'user_desktop', imageAvailable: true }))
            } else {
              if (!negotiated || !actions.includes(command.action)) throw new Error('unannounced_operation')
              operations++
              if (reply === 'silent') return
              const result = { ...command, type: 'host-operation-result', status: reply, ...(reply === 'accepted' ? {} : { code: reply === 'rejected' ? 'not_allowed' : 'system_error' }) }
              channel.send(JSON.stringify(result))
              if (reply === 'accepted' && command.action === 'restart') {
                presence = { ...presence, online: false, available: false }
                setTimeout(() => peer.close(), 100)
              }
            }
          } else if (message.type === 'bye') peer.close()
        } catch (error) { fatal = error instanceof Error ? error.message : 'fixture_failed' }
      }
    }
    await peer.setRemoteDescription({ type: 'offer', sdp: offer })
    for (const t of peer.getTransceivers()) t.direction = t.receiver.track.kind === 'video' ? 'sendonly' : 'inactive'
    await peer.setLocalDescription(await peer.createAnswer())
    await ready(() => peer.iceGatheringState === 'complete')
    localAnswer = peer.localDescription!.sdp; answer = localAnswer
    return { ok: true, id: '12345678-1234-4abc-8def-123456789abc' }
  },
  poll: async () => ({ status: 'answered', answer }), clipboardWatch: async () => {}, onClipboard: () => {}, clipboardWrite: () => {},
  saveBegin: async () => ({ ok: false, reason: 'cancelled' }), saveChunk: () => {}, saveFinish: async () => ({ ok: false, reason: 'io' }), saveCancel: () => {}, showInFolder: () => {}
}
const get = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T
;(window as unknown as { actionLab: object }).actionLab = {
  ready, delay,
  legacy: () => { legacy = true },
  connect: async () => {
    await ready(() => get<HTMLInputElement>('password').placeholder.length > 0)
    const before = authentications
    get<HTMLInputElement>('password').value = vector.password!
    get<HTMLFormElement>('login').requestSubmit()
    await ready(() => authentications > before && get('overlay').hidden && get<HTMLVideoElement>('video').videoWidth === 320 && get<HTMLVideoElement>('video').style.visibility !== 'hidden' && (legacy || !get('agent-context').hidden))
  },
  open: async (action: AgentAction) => {
    get<HTMLButtonElement>('agent-actions').click()
    await ready(() => {
      const current = document.querySelector<HTMLButtonElement>(`#agent-action-list [data-action="${action}"]`)
      return !!current && !current.disabled
    })
    const button = document.querySelector<HTMLButtonElement>(`#agent-action-list [data-action="${action}"]`)!
    button.click(); await ready(() => get<HTMLDialogElement>('agent-operation-dialog').open)
  },
  typeInModal: async () => {
    if (!get<HTMLDialogElement>('agent-operation-dialog').open) throw new Error('modal_not_open')
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', key: 'a', bubbles: true }))
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyA', key: 'a', bubbles: true }))
    await delay(100)
  },
  choose: (accepted: boolean) => get<HTMLButtonElement>(accepted ? 'agent-operation-confirm' : 'agent-operation-cancel').click(),
  withdraw: () => { actions = []; send(capabilities()) },
  restore: () => { actions = [...allActions]; send(capabilities()) },
  reply: (value: typeof reply) => { reply = value },
  returned: (lastSeenAt: string) => { presence = { online: true, available: true, lastSeenAt } },
  submit: () => { get<HTMLInputElement>('password').value = vector.password!; get<HTMLFormElement>('login').requestSubmit() },
  cancelWait: () => get<HTMLButtonElement>('restart-cancel').click(),
  state: () => ({ inputKeys, releases, requests, authentications, operations, presenceQueries, offlineOffers, nonceCount: nonces.size, fatal,
    message: get('message').textContent, overlayHidden: get('overlay').hidden, videoWidth: get<HTMLVideoElement>('video').videoWidth, videoVisibility: get<HTMLVideoElement>('video').style.visibility,
    menuHidden: get('agent-menu').hidden, dialogOpen: get<HTMLDialogElement>('agent-operation-dialog').open,
    actionDisabled: get<HTMLButtonElement>('agent-actions').disabled, waiting: !get('restart-cancel').hidden,
    cancelReachable: (() => { const button = get('restart-cancel'); const rect = button.getBoundingClientRect(); return !button.hidden && document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === button })(),
    passwordVisible: !get<HTMLInputElement>('password').hidden, notice: get('agent-operation-result').textContent,
    dialogFits: get('agent-operation-dialog').getBoundingClientRect().right <= innerWidth }),
  close: () => { clearInterval(timer); for (const t of tracks) t.stop(); for (const p of peers) p.close() }
}

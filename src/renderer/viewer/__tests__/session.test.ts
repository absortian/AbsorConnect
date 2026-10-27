import { describe, expect, it, vi, afterEach } from 'vitest'
import { ViewerSession, type SessionEvents } from '../session'
import type { AbsorViewerApi } from '../../../shared/remote/viewerBridge'

type SessionInternals = {
  pc: RTCPeerConnection | null
  control: RTCDataChannel
  input: RTCDataChannel
  pointer: RTCDataChannel
  audioTracks: Set<MediaStreamTrack>
  collectStats(pc: RTCPeerConnection): Promise<void>
  watch(pc: RTCPeerConnection, channel: RTCDataChannel): void
  teardown(): void
}

function fixture(): {
  session: ViewerSession
  internal: SessionInternals
  pc: RTCPeerConnection
  channel: RTCDataChannel
  message(data: object): void
  events: SessionEvents
} {
  const events = Object.fromEntries(
    [
      'phase',
      'video',
      'audio',
      'displays',
      'features',
      'quality',
      'stats',
      'fileChannel',
      'clipboard',
      'agentContext'
    ].map((name) => [name, vi.fn()])
  ) as unknown as SessionEvents
  const session = new ViewerSession({} as AbsorViewerApi, events)
  const internal = session as unknown as SessionInternals
  const pc = {
    connectionState: 'connected',
    getStats: vi.fn().mockResolvedValue(new Map()),
    close: vi.fn()
  } as unknown as RTCPeerConnection
  const channel = {
    readyState: 'open',
    send: vi.fn(),
    onmessage: null
  } as unknown as RTCDataChannel
  internal.pc = pc
  internal.control = channel
  internal.watch(pc, channel)
  const message = (data: object): void => {
    channel.onmessage?.({ data: JSON.stringify(data) } as MessageEvent)
  }
  return { session, internal, pc, channel, message, events }
}

afterEach(() => vi.useRealTimers())
describe('negociación y consultas tardías del visor', () => {
  it('no manda calidad a un host anterior; espera confirmación y reaplica al reconectar', () => {
    vi.useFakeTimers()
    const f = fixture()
    f.message({ v: 1, type: 'features', audio: true })
    f.session.selectQuality('smooth')
    expect(f.channel.send).not.toHaveBeenCalled()
    f.message({ v: 1, type: 'features', streamQuality: true })
    f.session.selectQuality('smooth')
    expect(f.channel.send).toHaveBeenLastCalledWith(
      JSON.stringify({ v: 1, type: 'set-stream-quality', profile: 'smooth' })
    )
    expect(f.events.quality).not.toHaveBeenCalled()
    f.message({ v: 2, type: 'stream-quality', profile: 'smooth' })
    expect(f.events.quality).not.toHaveBeenCalled()
    f.message({ v: 1, type: 'stream-quality', profile: 'balanced' })
    expect(f.events.quality).toHaveBeenCalledWith('balanced')
    f.internal.teardown()
    f.internal.pc = f.pc
    f.internal.control = f.channel
    f.internal.watch(f.pc, f.channel)
    vi.mocked(f.channel.send).mockClear()
    f.message({ v: 1, type: 'features', streamQuality: true })
    expect(f.channel.send).toHaveBeenCalledWith(
      JSON.stringify({ v: 1, type: 'set-stream-quality', profile: 'smooth' })
    )
    f.internal.teardown()
  })
  it('descarta getStats al cerrar, evita solapamientos y captura errores', async () => {
    vi.useFakeTimers()
    const f = fixture()
    let release!: (value: RTCStatsReport) => void
    vi.mocked(f.pc.getStats).mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve
      })
    )
    const pending = f.internal.collectStats(f.pc)
    await f.internal.collectStats(f.pc)
    expect(f.pc.getStats).toHaveBeenCalledTimes(1)
    f.internal.teardown()
    vi.mocked(f.events.stats).mockClear()
    release(new Map() as RTCStatsReport)
    await pending
    expect(f.events.stats).not.toHaveBeenCalled()
    f.internal.pc = f.pc
    vi.mocked(f.pc.getStats).mockRejectedValueOnce(new Error('closed'))
    await expect(f.internal.collectStats(f.pc)).resolves.toBeUndefined()
    expect(f.events.stats).toHaveBeenCalledWith({
      route: null,
      fps: null,
      rttMs: null,
      width: null,
      height: null,
      kbps: null,
      bufferMs: null
    })
    f.internal.teardown()
  })
})

describe('contexto de agente en la sesión autenticada', () => {
  it('negocia una sola vez, suelta entrada, corta audio y contenido y descarta contexto antiguo', () => {
    vi.useFakeTimers()
    const f = fixture()
    f.internal.input = f.channel
    f.internal.pointer = f.channel
    const track = { enabled: true } as MediaStreamTrack
    f.internal.audioTracks.add(track)
    const features = {
      v: 1,
      type: 'features',
      unattendedControl: true,
      audio: true,
      files: true,
      clipboard: true
    }
    f.message(features)
    f.message(features)
    expect(
      vi
        .mocked(f.channel.send)
        .mock.calls.filter(([raw]) => JSON.parse(String(raw)).type === 'agent-control-enable')
    ).toHaveLength(1)
    expect(track.enabled).toBe(false)
    f.message({
      v: 1,
      extension: 1,
      type: 'agent-capabilities',
      agentVersion: '0.1.0',
      actions: [],
      capabilities: { administration: false, login: true, secureAttention: false, restart: false }
    })
    f.message({
      v: 1,
      extension: 1,
      type: 'agent-context',
      sequence: 1,
      state: 'user_desktop',
      imageAvailable: true
    })
    expect(track.enabled).toBe(true)
    f.session.sendInput({ type: 'key', code: 'KeyA', down: true })
    f.message({
      v: 1,
      extension: 1,
      type: 'agent-context',
      sequence: 2,
      state: 'transition',
      imageAvailable: false
    })
    expect(track.enabled).toBe(false)
    expect(f.events.features).toHaveBeenLastCalledWith(
      expect.objectContaining({ audio: false, files: false, clipboard: false })
    )
    expect(f.channel.send).toHaveBeenLastCalledWith(JSON.stringify({ v: 1, type: 'release-all' }))
    vi.mocked(f.channel.send).mockClear()
    f.session.sendInput({ type: 'key', code: 'KeyA', down: true })
    f.session.sendPointer(0.4, 0.5)
    expect(f.channel.send).not.toHaveBeenCalled()
    f.message({
      v: 1,
      type: 'clipboard',
      id: 1,
      kind: 'text',
      index: 0,
      count: 1,
      data: 'dato ficticio'
    })
    expect(f.events.clipboard).not.toHaveBeenCalled()
    f.message({
      v: 1,
      extension: 1,
      type: 'agent-context',
      sequence: 1,
      state: 'user_desktop',
      imageAvailable: true
    })
    expect(f.events.agentContext).toHaveBeenLastCalledWith(
      expect.objectContaining({ sequence: 2, imageAvailable: false })
    )
    f.message({
      v: 1,
      extension: 1,
      type: 'agent-context',
      sequence: 3,
      state: 'login',
      imageAvailable: true
    })
    f.session.sendInput({ type: 'key', code: 'Tab', down: true })
    expect(f.channel.send).toHaveBeenLastCalledWith(
      JSON.stringify({ v: 1, type: 'key', code: 'Tab', down: true })
    )
    f.message({
      v: 1,
      extension: 1,
      type: 'agent-context',
      sequence: 4,
      state: 'user_desktop',
      imageAvailable: true
    })
    expect(track.enabled).toBe(false)
    f.internal.teardown()
  })
})

import { describe, expect, it, vi, afterEach } from 'vitest'
import { ViewerSession, type SessionEvents } from '../session'
import type { AbsorViewerApi } from '../../../shared/remote/viewerBridge'

type SessionInternals = {
  pc: RTCPeerConnection | null
  control: RTCDataChannel
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
      'clipboard'
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

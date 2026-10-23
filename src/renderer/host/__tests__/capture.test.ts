import { describe, expect, it, vi, type Mock } from 'vitest'
import { HostCapture, videoConstraints } from '../capture'

function fixture(prepare?: (stream: MediaStream) => Promise<void>): {
  track: { kind: string; stop: Mock; applyConstraints: Mock; contentHint: string }
  stream: MediaStream
  sender: { replaceTrack: Mock; getParameters: () => { encodings: object[] }; setParameters: Mock }
  acquire: Mock
  capture: HostCapture
  disallow(): void
} {
  const track = {
    kind: 'video',
    stop: vi.fn(),
    applyConstraints: vi.fn().mockResolvedValue(undefined),
    contentHint: ''
  }
  const stream = {
    getTracks: () => [track],
    getVideoTracks: () => [track]
  } as unknown as MediaStream
  const sender = {
    replaceTrack: vi.fn().mockResolvedValue(undefined),
    getParameters: () => ({ encodings: [{}] }),
    setParameters: vi.fn().mockResolvedValue(undefined)
  }
  const transceivers = (): RTCRtpTransceiver[] =>
    [{ receiver: { track: { kind: 'video' } }, sender }] as unknown as RTCRtpTransceiver[]
  const acquire = vi.fn().mockResolvedValue(stream)
  let allowed = true
  const capture = new HostCapture({ allowed: () => allowed, acquire, prepare, transceivers })
  return {
    track,
    stream,
    sender,
    acquire,
    capture,
    disallow: () => {
      allowed = false
    }
  }
}

describe('captura autenticada y ordenada', () => {
  it('no inicia ni cambia perfiles cuando no está autorizado', async () => {
    const f = fixture()
    f.disallow()
    await f.capture.run(() => f.capture.replace())
    await f.capture.run(() => f.capture.setProfile('native'))
    expect(f.acquire).not.toHaveBeenCalled()
    expect(f.capture.profile).toBe('balanced')
  })

  it('limita el perfil inicial y conserva el nuevo al cambiar de monitor', async () => {
    const f = fixture()
    await f.capture.run(() => f.capture.replace())
    expect(f.acquire).toHaveBeenCalledWith('balanced')
    expect(f.track.applyConstraints).toHaveBeenLastCalledWith(videoConstraints('balanced'))
    await f.capture.run(() => f.capture.setProfile('smooth'))
    expect(f.sender.setParameters).toHaveBeenLastCalledWith({
      degradationPreference: 'maintain-framerate',
      encodings: [{ maxBitrate: 3_000_000, maxFramerate: 30 }]
    })
    await f.capture.run(() => f.capture.replace())
    expect(f.acquire).toHaveBeenLastCalledWith('smooth')
    expect(videoConstraints('native')).not.toHaveProperty('width')
  })

  it('serializa cambios durante una adquisición pendiente', async () => {
    const f = fixture()
    let release!: (stream: MediaStream) => void
    f.acquire.mockReturnValueOnce(
      new Promise<MediaStream>((resolve) => {
        release = resolve
      })
    )
    const first = f.capture.run(() => f.capture.replace())
    const second = f.capture.run(() => f.capture.setProfile('native'))
    await Promise.resolve()
    expect(f.track.applyConstraints).not.toHaveBeenCalled()
    release(f.stream)
    await Promise.all([first, second])
    expect(f.capture.profile).toBe('native')
    expect(f.track.applyConstraints.mock.calls.map(([c]) => c)).toEqual([
      videoConstraints('balanced'),
      videoConstraints('native')
    ])
  })

  it('restaura el perfil confirmado si el navegador rechaza la codificación', async () => {
    const f = fixture()
    await f.capture.run(() => f.capture.replace())
    f.sender.setParameters.mockRejectedValueOnce(new Error('unsupported'))
    await f.capture.run(() => f.capture.setProfile('smooth'))
    expect(f.capture.profile).toBe('balanced')
    expect(f.track.contentHint).toBe('detail')
    expect(f.track.applyConstraints).toHaveBeenLastCalledWith(videoConstraints('balanced'))
  })

  it('para una captura adquirida después de cerrar y descarta operaciones en cola', async () => {
    const f = fixture()
    let release!: (stream: MediaStream) => void
    f.acquire.mockReturnValueOnce(
      new Promise<MediaStream>((resolve) => {
        release = resolve
      })
    )
    const first = f.capture.run(() => f.capture.replace())
    const queued = f.capture.run(() => f.capture.setProfile('native'))
    await Promise.resolve()
    f.capture.close()
    release(f.stream)
    await Promise.all([first, queued])
    expect(f.track.stop).toHaveBeenCalled()
    expect(f.sender.replaceTrack).not.toHaveBeenCalled()
    expect(f.capture.stream).toBeNull()
  })

  it('para la pista pendiente inmediatamente al cerrar durante la preparación de audio', async () => {
    let release!: () => void
    const prepare = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        })
    )
    const f = fixture(prepare)
    const pending = f.capture.run(() => f.capture.replace())
    await vi.waitFor(() => expect(prepare).toHaveBeenCalled())
    f.capture.close()
    expect(f.track.stop).toHaveBeenCalled()
    release()
    await pending
    expect(f.sender.replaceTrack).not.toHaveBeenCalled()
  })

  it('para pistas también si falla la instalación o se cierra durante replaceTrack', async () => {
    const f = fixture()
    f.sender.replaceTrack.mockImplementationOnce(async () => f.capture.close())
    await f.capture.run(() => f.capture.replace())
    expect(f.track.stop).toHaveBeenCalled()
    const g = fixture()
    g.sender.setParameters.mockRejectedValueOnce(new Error('rejected'))
    await expect(g.capture.run(() => g.capture.replace())).rejects.toThrow('rejected')
    expect(g.track.stop).toHaveBeenCalled()
  })
})

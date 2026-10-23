import type { StreamProfile } from '../../shared/remote/protocol'

export const STREAM_SETTINGS = {
  balanced: {
    width: 1920,
    height: 1080,
    hint: 'detail',
    degradation: 'balanced',
    bitrate: 6_000_000
  },
  smooth: {
    width: 1280,
    height: 720,
    hint: 'motion',
    degradation: 'maintain-framerate',
    bitrate: 3_000_000
  },
  native: {
    width: null,
    height: null,
    hint: 'detail',
    degradation: 'maintain-resolution',
    bitrate: 6_000_000
  }
} as const

/** Máximos, sin recorte ni ampliación: se conserva toda la pantalla y su proporción. */
export function videoConstraints(profile: StreamProfile): MediaTrackConstraints {
  const settings = STREAM_SETTINGS[profile]
  return {
    frameRate: { ideal: 30, max: 30 },
    ...(settings.width ? { width: { max: settings.width }, height: { max: settings.height } } : {})
  }
}

export async function configureVideo(
  track: MediaStreamTrack,
  sender: RTCRtpSender,
  profile: StreamProfile
): Promise<void> {
  const settings = STREAM_SETTINGS[profile]
  await track.applyConstraints(videoConstraints(profile))
  track.contentHint = settings.hint
  const parameters = sender.getParameters()
  parameters.degradationPreference = settings.degradation
  for (const encoding of parameters.encodings) {
    encoding.maxBitrate = settings.bitrate
    encoding.maxFramerate = 30
  }
  await sender.setParameters(parameters)
}

interface CaptureOptions {
  allowed(): boolean
  acquire(profile: StreamProfile): Promise<MediaStream>
  transceivers(): RTCRtpTransceiver[]
}

/** Una sola operación de captura/monitor/perfil; el cierre cancela también adquisiciones tardías. */
export class HostCapture {
  stream: MediaStream | null = null
  profile: StreamProfile = 'balanced'
  private tail: Promise<unknown> = Promise.resolve()
  private closed = false

  constructor(private readonly options: CaptureOptions) {}

  run<T>(operation: () => Promise<T>): Promise<T | undefined> {
    const next = this.tail.then(() => {
      if (this.closed || !this.options.allowed()) return undefined
      return operation()
    })
    this.tail = next.catch(() => undefined)
    return next
  }

  async replace(): Promise<void> {
    if (!this.active) return
    const next = await this.options.acquire(this.profile)
    try {
      if (!this.active) return
      for (const transceiver of this.options.transceivers()) {
        const kind = transceiver.receiver.track.kind
        const track = next.getTracks().find((candidate) => candidate.kind === kind)
        if (!track) continue
        await transceiver.sender.replaceTrack(track)
        if (!this.active) return
        if (kind === 'video') await configureVideo(track, transceiver.sender, this.profile)
        if (!this.active) return
      }
      this.stop(this.stream)
      this.stream = next
    } finally {
      if (this.stream !== next || !this.active) this.stop(next)
    }
  }

  /** Si el navegador rechaza un cambio, se restaura el anterior antes de confirmarlo. */
  async setProfile(profile: StreamProfile): Promise<void> {
    const track = this.stream?.getVideoTracks()[0]
    const sender = this.options
      .transceivers()
      .find((t) => t.receiver.track.kind === 'video')?.sender
    if (!this.active || !track || !sender || profile === this.profile) return
    try {
      await configureVideo(track, sender, profile)
      if (this.active) this.profile = profile
    } catch {
      if (this.active) await configureVideo(track, sender, this.profile)
    }
  }

  close(): void {
    this.closed = true
    this.stop(this.stream)
    this.stream = null
  }

  private get active(): boolean {
    return !this.closed && this.options.allowed()
  }

  private stop(stream: MediaStream | null): void {
    stream?.getTracks().forEach((track) => track.stop())
  }
}

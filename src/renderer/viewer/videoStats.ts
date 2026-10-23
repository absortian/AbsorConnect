export interface VideoStats {
  route: 'direct' | 'relay' | null
  rttMs: number | null
  fps: number | null
  width: number | null
  height: number | null
  kbps: number | null
  bufferMs: number | null
}

interface Entry {
  id: string
  type: string
  timestamp: number
  [key: string]: unknown
}
interface Report {
  forEach(callback: (entry: Entry) => void): void
  get(id: string): Entry | undefined
}
const rounded = (value: number | null): number | null =>
  value !== null && Number.isFinite(value) && value >= 0 ? Math.round(value) : null
const number = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null

export function emptyVideoStats(): VideoStats {
  return {
    route: null,
    rttMs: null,
    fps: null,
    width: null,
    height: null,
    kbps: null,
    bufferMs: null
  }
}

/** Solo contadores de vídeo entrante y del par elegido. No conserva direcciones ni informes. */
export class VideoStatsSampler {
  private previous: {
    id: string
    at: number
    bytes: number | null
    frames: number | null
    delay: number | null
    emitted: number | null
  } | null = null

  reset(): void {
    this.previous = null
  }

  sample(report: Report): VideoStats {
    const stats = emptyVideoStats()
    let pair: Entry | undefined
    let fallback: Entry | undefined
    let video: Entry | undefined
    report.forEach((entry) => {
      if (entry.type === 'transport' && typeof entry.selectedCandidatePairId === 'string') {
        pair = report.get(entry.selectedCandidatePairId)
      }
      if (
        entry.type === 'candidate-pair' &&
        entry.state === 'succeeded' &&
        entry.nominated === true
      )
        fallback ??= entry
      if (
        entry.type === 'inbound-rtp' &&
        (entry.kind ?? entry.mediaType) === 'video' &&
        entry.isRemote !== true
      )
        video ??= entry
    })
    pair ??= fallback
    const local =
      typeof pair?.localCandidateId === 'string' ? report.get(pair.localCandidateId) : undefined
    const remote =
      typeof pair?.remoteCandidateId === 'string' ? report.get(pair.remoteCandidateId) : undefined
    if (pair)
      stats.route =
        local?.candidateType === 'relay' ||
        remote?.candidateType === 'relay' ||
        typeof local?.relayProtocol === 'string'
          ? 'relay'
          : 'direct'
    const rtt = number(pair?.currentRoundTripTime)
    stats.rttMs = rounded(rtt === null ? null : rtt * 1000)
    if (!video) {
      this.reset()
      return stats
    }
    const current = {
      id: video.id,
      at: video.timestamp,
      bytes: number(video.bytesReceived),
      frames: number(video.framesDecoded),
      delay: number(video.jitterBufferDelay),
      emitted: number(video.jitterBufferEmittedCount)
    }
    const previous = this.previous
    const elapsed = previous && previous.id === current.id ? current.at - previous.at : 0
    const delta = (key: 'bytes' | 'frames' | 'delay' | 'emitted'): number | null => {
      const before = previous?.[key]
      const after = current[key]
      return elapsed > 0 &&
        Number.isFinite(elapsed) &&
        before != null &&
        after != null &&
        after >= before
        ? after - before
        : null
    }
    const bytes = delta('bytes'),
      frames = delta('frames'),
      delay = delta('delay'),
      emitted = delta('emitted')
    const fps =
      number(video.framesPerSecond) ?? (frames === null ? null : (frames * 1000) / elapsed)
    stats.fps = rounded(fps)
    stats.kbps = rounded(bytes === null ? null : (bytes * 8) / elapsed)
    stats.bufferMs = rounded(
      delay === null || emitted === null || emitted <= 0 ? null : (delay * 1000) / emitted
    )
    stats.width = number(video.frameWidth)
    stats.height = number(video.frameHeight)
    if (!stats.width || !stats.height) stats.width = stats.height = null
    this.previous = current
    return stats
  }
}

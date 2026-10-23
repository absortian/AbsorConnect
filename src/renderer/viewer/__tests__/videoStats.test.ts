import { describe, expect, it } from 'vitest'
import { VideoStatsSampler } from '../videoStats'

const report = (
  at: number,
  values: Record<string, unknown> = {},
  id = 'v'
): Map<string, { id: string; type: string; timestamp: number; [key: string]: unknown }> =>
  new Map([
    [
      'v',
      {
        id,
        type: 'inbound-rtp',
        kind: 'video',
        timestamp: at,
        bytesReceived: at * 100,
        framesDecoded: at * 0.03,
        jitterBufferDelay: at * 0.0006,
        jitterBufferEmittedCount: at * 0.03,
        frameWidth: 1920,
        frameHeight: 1080,
        ...values
      }
    ],
    [
      'a',
      {
        id: 'a',
        type: 'inbound-rtp',
        kind: 'audio',
        timestamp: at,
        framesPerSecond: 99,
        bytesReceived: 99999999
      }
    ],
    ['t', { id: 't', type: 'transport', timestamp: at, selectedCandidatePairId: 'p' }],
    [
      'p',
      {
        id: 'p',
        type: 'candidate-pair',
        timestamp: at,
        localCandidateId: 'l',
        remoteCandidateId: 'r',
        currentRoundTripTime: 0.02
      }
    ],
    [
      'l',
      {
        id: 'l',
        type: 'local-candidate',
        timestamp: at,
        candidateType: 'prflx',
        relayProtocol: 'tls'
      }
    ]
  ])

describe('estadísticas por intervalo', () => {
  it('no inventa intervalos en la primera muestra y excluye audio', () => {
    const sampler = new VideoStatsSampler()
    expect(sampler.sample(report(1000))).toEqual({
      route: 'relay',
      rttMs: 20,
      fps: null,
      width: 1920,
      height: 1080,
      kbps: null,
      bufferMs: null
    })
    expect(sampler.sample(report(2000))).toEqual({
      route: 'relay',
      rttMs: 20,
      fps: 30,
      width: 1920,
      height: 1080,
      kbps: 800,
      bufferMs: 20
    })
  })
  it('reinicia al cambiar de flujo, retroceder contadores o repetir timestamp', () => {
    const sampler = new VideoStatsSampler()
    sampler.sample(report(2000))
    expect(
      sampler.sample(
        report(3000, {
          bytesReceived: 1,
          framesDecoded: 1,
          jitterBufferDelay: 0,
          jitterBufferEmittedCount: 1
        })
      ).kbps
    ).toBeNull()
    expect(sampler.sample(report(3000)).fps).toBeNull()
    expect(sampler.sample(report(4000, {}, 'other')).kbps).toBeNull()
    sampler.reset()
    expect(sampler.sample(report(5000)).bufferMs).toBeNull()
  })
  it('valores ausentes/no finitos quedan desconocidos; cero fps sí es válido', () => {
    const sampler = new VideoStatsSampler()
    const stats = sampler.sample(
      report(1000, {
        framesPerSecond: 0,
        frameWidth: NaN,
        bytesReceived: Infinity,
        jitterBufferDelay: -1
      })
    )
    expect(stats.fps).toBe(0)
    expect(stats.width).toBeNull()
    expect(stats.height).toBeNull()
    expect(stats.kbps).toBeNull()
    expect(sampler.sample(new Map()).route).toBeNull()
  })
})

// @ts-nocheck
import { configureVideo, videoConstraints, STREAM_SETTINGS } from '../../../src/renderer/host/capture'

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const pick = (report, type) => [...report.values()].find(s => s.type === type && (s.kind || s.mediaType) === 'video')
const results = []
let stream, a, b
;(async () => {
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: videoConstraints('native'), audio: false })
    const [track] = stream.getVideoTracks()
    const source = track.getSettings()
    a = new RTCPeerConnection({ iceServers: [] })
    b = new RTCPeerConnection({ iceServers: [] })
    const pendingA = [], pendingB = []
    a.onicecandidate = e => { if (e.candidate) b.remoteDescription ? void b.addIceCandidate(e.candidate) : pendingB.push(e.candidate) }
    b.onicecandidate = e => { if (e.candidate) a.remoteDescription ? void a.addIceCandidate(e.candidate) : pendingA.push(e.candidate) }
    const video = document.createElement('video')
    video.autoplay = true; video.muted = true; video.playsInline = true
    document.body.append(video)
    b.ontrack = e => { video.srcObject = new MediaStream([e.track]); void video.play() }
    b.addTransceiver('video', { direction: 'recvonly' })
    await b.setLocalDescription(await b.createOffer())
    await a.setRemoteDescription(b.localDescription)
    for (const candidate of pendingA.splice(0)) await a.addIceCandidate(candidate)
    a.getTransceivers().forEach(t => { t.direction = 'sendonly' })
    await a.setLocalDescription(await a.createAnswer())
    await b.setRemoteDescription(a.localDescription)
    for (const candidate of pendingB.splice(0)) await b.addIceCandidate(candidate)
    const sender = a.getTransceivers()[0].sender
    await sender.replaceTrack(track)
    for (const profile of ['native', 'balanced', 'smooth', 'native']) {
      await configureVideo(track, sender, profile)
      await sleep(3500)
      const settings = track.getSettings()
      const maximum = STREAM_SETTINGS[profile]
      if (maximum.width && (settings.width > maximum.width || settings.height > maximum.height)) throw Error('Captura excede el máximo del perfil')
      if (Math.abs(settings.width / settings.height - source.width / source.height) > 0.01) throw Error('La captura no conserva la proporción')
      if (settings.width > source.width || settings.height > source.height) throw Error('La captura se ha ampliado')
      if (profile === 'native' && (settings.width !== source.width || settings.height !== source.height)) throw Error('No se recuperó la resolución nativa')
      let previous
      const samples = []
      for (let second = 0; second < 9; second++) {
        const [out, inbound] = await Promise.all([a.getStats(), b.getStats()])
        const tx = pick(out, 'outbound-rtp'), rx = pick(inbound, 'inbound-rtp')
        const at = performance.now()
        if (previous && rx && tx) {
          const seconds = (at - previous.at) / 1000
          const decoded = rx.framesDecoded - previous.rx.framesDecoded
          const emitted = rx.jitterBufferEmittedCount - previous.rx.jitterBufferEmittedCount
          samples.push({ width: tx.frameWidth, height: tx.frameHeight, sentFps: tx.framesPerSecond,
            decodedFps: decoded / seconds, kbps: (tx.bytesSent - previous.tx.bytesSent) * 8 / seconds / 1000,
            limitation: tx.qualityLimitationReason, codec: out.get(tx.codecId)?.mimeType,
            encoder: tx.encoderImplementation, decoder: rx.decoderImplementation,
            encodeMs: tx.framesEncoded > previous.tx.framesEncoded ? (tx.totalEncodeTime - previous.tx.totalEncodeTime) * 1000 / (tx.framesEncoded - previous.tx.framesEncoded) : null,
            bufferMs: emitted > 0 ? (rx.jitterBufferDelay - previous.rx.jitterBufferDelay) * 1000 / emitted : null })
        }
        previous = { at, rx, tx }
        if (second < 8) await sleep(1000)
      }
      if (samples.length < 4 || samples.every(s => !(s.decodedFps > 0))) throw Error('Recepción de vídeo insuficiente')
      const average = key => samples.reduce((sum, row) => sum + (row[key] || 0), 0) / samples.length
      results.push({ profile, capture: { width: settings.width, height: settings.height, frameRate: settings.frameRate },
        summary: { decodedFps: average('decodedFps'), sentFps: average('sentFps'), kbps: average('kbps'), bufferMs: average('bufferMs') }, samples })
    }
    stream.getTracks().forEach(t => t.stop()); a.close(); b.close()
    window.lab.result({ source: { width: source.width, height: source.height, frameRate: source.frameRate }, results, error: null })
  } catch (error) {
    stream?.getTracks().forEach(t => t.stop()); a?.close(); b?.close()
    window.lab.result({ results, error: String(error) })
  }
})()

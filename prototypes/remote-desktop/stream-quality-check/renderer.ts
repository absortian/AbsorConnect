// @ts-nocheck
import { configureVideo, STREAM_SETTINGS } from '../../../src/renderer/host/capture'
import type { StreamProfile } from '../../../src/shared/remote/protocol'
declare global { interface Window { lab: { config(): Promise<{iceServers: RTCIceServer[]; route: string}>; result(value: unknown): void } } }
// Imagen artificial: no captura de pantalla, entrada del sistema ni datos personales.
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const configPromise = window.lab.config()
function pick(report, type, kind) {
  return [...report.values()].find(s => s.type === type && (!kind || (s.kind || s.mediaType) === kind))
}
function pairInfo(report) {
  const transport = pick(report, 'transport')
  const pair = transport && report.get(transport.selectedCandidatePairId)
  const local = pair && report.get(pair.localCandidateId)
  const remote = pair && report.get(pair.remoteCandidateId)
  return { pair, safe: { local: local?.candidateType, remote: remote?.candidateType,
    relayProtocol: local?.relayProtocol, rttMs: pair?.currentRoundTripTime * 1000,
    availableOutgoingBitrate: pair?.availableOutgoingBitrate } }
}
async function runCase(profile: StreamProfile) {
  const settings = STREAM_SETTINGS[profile]
  const width = settings.width ?? 3840, height = settings.height ?? 2160
  const preference = settings.degradation, hint = settings.hint
  const config = await configPromise
  const a = new RTCPeerConnection({ iceServers: config.iceServers })
  const b = new RTCPeerConnection({ iceServers: config.iceServers,
    iceTransportPolicy: ['direct', 'limited'].includes(config.route) ? 'all' : 'relay' })
  const canvas = document.createElement('canvas')
  canvas.width = width; canvas.height = height
  const context = canvas.getContext('2d', { alpha: false })
  const stream = canvas.captureStream(30)
  const [track] = stream.getVideoTracks()
  track.contentHint = hint
  const video = document.createElement('video')
  video.muted = true; video.autoplay = true; video.playsInline = true
  document.body.append(video)
  const rtts = [], intervals = [], samples = []
  let lastPresented, stopped = false, drawing, echoTimer
  const sent = new Map()
  const echo = b.createDataChannel('input-transport-test')
  echo.onmessage = e => { const at = sent.get(e.data); if (at) { rtts.push(performance.now() - at); sent.delete(e.data) } }
  a.ondatachannel = e => { e.channel.onmessage = message => e.channel.send(message.data) }
  b.ontrack = e => { video.srcObject = new MediaStream([e.track]); void video.play() }
  // Negociación recvonly primero, pista añadida después: como el host publicado.
  b.addTransceiver('video', { direction: 'recvonly' })
  const pendingA = [], pendingB = []
  a.onicecandidate = e => { if (e.candidate) { if (b.remoteDescription) void b.addIceCandidate(e.candidate); else pendingB.push(e.candidate) } }
  b.onicecandidate = e => { if (e.candidate) { if (a.remoteDescription) void a.addIceCandidate(e.candidate); else pendingA.push(e.candidate) } }
  const draw = () => {
    const now = performance.now()
    context.fillStyle = '#eeeeee'; context.fillRect(0, 0, width, height)
    context.fillStyle = '#222222'; context.font = `${Math.max(14, height / 45)}px monospace`
    const rowHeight = Math.max(22, height / 32)
    const offset = (now / 25) % rowHeight
    for (let y = -rowHeight; y < height; y += rowHeight) {
      context.fillText('AbsorConnect - prueba artificial de texto y desplazamiento 0123456789', 20, y + offset)
    }
    context.fillStyle = '#4060b0'; context.fillRect((now / 3) % width - width / 5, height / 3, width / 5, height / 3)
  }
  draw(); drawing = setInterval(draw, 1000 / 30)
  const presented = (_, metadata) => {
    if (stopped) return
    if (lastPresented !== undefined) intervals.push(metadata.expectedDisplayTime - lastPresented)
    lastPresented = metadata.expectedDisplayTime
    video.requestVideoFrameCallback(presented)
  }
  video.requestVideoFrameCallback(presented)
  try {
    await b.setLocalDescription(await b.createOffer())
    await a.setRemoteDescription(b.localDescription)
    for (const candidate of pendingA.splice(0)) await a.addIceCandidate(candidate)
    a.getTransceivers().forEach(t => { t.direction = 'sendonly' })
    await a.setLocalDescription(await a.createAnswer())
    await b.setRemoteDescription(a.localDescription)
    for (const candidate of pendingB.splice(0)) await b.addIceCandidate(candidate)
    const sender = a.getTransceivers()[0].sender
    await sender.replaceTrack(track)
    await configureVideo(track, sender, profile)
    const parameters = sender.getParameters()
    if (config.route === 'limited') parameters.encodings[0].maxBitrate = 1000000
    await sender.setParameters(parameters)
    const deadline = Date.now() + 20000
    while (a.connectionState !== 'connected' || b.connectionState !== 'connected' || echo.readyState !== 'open') {
      if (Date.now() > deadline) throw Error('Conexión de laboratorio agotada')
      await sleep(100)
    }
    let sequence = 0
    echoTimer = setInterval(() => {
      const key = String(sequence++); sent.set(key, performance.now()); echo.send(key)
    }, 100)
    await sleep(5000)
    intervals.length = 0; rtts.length = 0; lastPresented = undefined
    let previous = null
    for (let second = 0; second < 13; second++) {
      const [out, inbound] = await Promise.all([a.getStats(), b.getStats()])
      const source = pick(out, 'media-source', 'video'), tx = pick(out, 'outbound-rtp', 'video')
      const rx = pick(inbound, 'inbound-rtp', 'video'), codec = tx && out.get(tx.codecId)
      const current = { at: performance.now(), tx, rx }
      const delta = (side, key) => previous && typeof current[side]?.[key] === 'number' && typeof previous[side]?.[key] === 'number'
        ? current[side][key] - previous[side][key] : null
      const span = previous ? (current.at - previous.at) / 1000 : 1
      if (previous) samples.push({ captureFps: source?.framesPerSecond, sentFps: tx?.framesPerSecond,
        decodedFps: delta('rx', 'framesDecoded') / span, kbps: delta('tx', 'bytesSent') * 8 / span / 1000,
        width: tx?.frameWidth, height: tx?.frameHeight, limitation: tx?.qualityLimitationReason,
        encodeMs: delta('tx', 'framesEncoded') > 0 ? delta('tx', 'totalEncodeTime') * 1000 / delta('tx', 'framesEncoded') : null,
        decodeMs: delta('rx', 'framesDecoded') > 0 ? delta('rx', 'totalDecodeTime') * 1000 / delta('rx', 'framesDecoded') : null,
        jitterMs: rx?.jitter * 1000, lost: delta('rx', 'packetsLost'), received: delta('rx', 'packetsReceived'),
        freezeCount: delta('rx', 'freezeCount'), freezesSeconds: delta('rx', 'totalFreezesDuration'),
        bufferMs: delta('rx', 'jitterBufferEmittedCount') > 0 ? delta('rx', 'jitterBufferDelay') * 1000 / delta('rx', 'jitterBufferEmittedCount') : null,
        encoder: tx?.encoderImplementation, decoder: rx?.decoderImplementation, codec: codec?.mimeType,
        senderPair: pairInfo(out).safe, receiverPair: pairInfo(inbound).safe })
      previous = current
      if (second < 12) await sleep(1000)
    }
    const percentile = (values, fraction) => [...values].sort((x,y) => x-y)[Math.floor((values.length - 1) * fraction)] ?? null
    const average = key => samples.reduce((sum, row) => sum + (row[key] || 0), 0) / samples.length
    const result = { profile, width, height, sourceWidth: 3840, sourceHeight: 2160, captureIsSyntheticPresized: true, preference, hint, samples,
      summary: { decodedFps: average('decodedFps'), sentFps: average('sentFps'), kbps: average('kbps'),
        encodeMs: average('encodeMs'), decodeMs: average('decodeMs'), jitterBufferMs: average('bufferMs'),
        transportRttP50: percentile(rtts, .5), transportRttP95: percentile(rtts, .95),
        presentationIntervalP95: percentile(intervals, .95), presentations: intervals.length,
        loss: samples.reduce((sum,r) => sum + (r.lost || 0),0), freezes: samples.reduce((sum,r) => sum + (r.freezeCount || 0),0) } }
    if (samples.every(s => !(s.decodedFps > 0))) throw Error('No se decodificaron fotogramas')
    if (!['direct', 'limited'].includes(config.route) && samples.some(s => s.receiverPair.local !== 'relay')) throw Error('No se seleccionó relé')
    return result
  } finally {
    stopped = true; clearInterval(drawing); clearInterval(echoTimer)
    a.close(); b.close(); track.stop(); video.srcObject = null; video.remove()
  }
}
(async () => {
  const results = []
  try {
    const config = await configPromise
    for (const profile of ['native', 'balanced', 'smooth'] as const) {
      results.push(await runCase(profile))
    }
    window.lab.result({ results, error: null })
  } catch (e) { window.lab.result({ results, error: String(e) }) }
})()

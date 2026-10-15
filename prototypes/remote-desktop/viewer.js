// Lado del controlador: recibe la pantalla y mide imágenes por segundo, latencia y nivel de sonido
const { send, onSignal } = window.proto

const pc = new RTCPeerConnection()
pc.onicecandidate = (event) => event.candidate && send('signal', { to: 'host', candidate: event.candidate.toJSON() })
onSignal(async (message) => {
  if (message.sdp) {
    await pc.setRemoteDescription(message.sdp)
    await pc.setLocalDescription(await pc.createAnswer())
    send('signal', { to: 'host', sdp: pc.localDescription.toJSON() })
  }
  if (message.candidate) await pc.addIceCandidate(message.candidate)
})

let analyser = null
const samples = new Float32Array(2048)
pc.ontrack = (event) => {
  const [stream] = event.streams
  if (event.track.kind === 'video') document.getElementById('video').srcObject = stream
  if (event.track.kind === 'audio') {
    // Chromium solo entrega el audio remoto a WebAudio si está en un elemento <audio> (en silencio:
    // reproducirlo cerraría el bucle con la captura del sistema)
    document.getElementById('audio').srcObject = new MediaStream([event.track])
    const ctx = new AudioContext()
    ctx.resume()
    analyser = ctx.createAnalyser()
    analyser.fftSize = samples.length
    ctx.createMediaStreamSource(new MediaStream([event.track])).connect(analyser)
  }
}

function rms() {
  if (!analyser) return null
  analyser.getFloatTimeDomainData(samples)
  let sum = 0
  for (const v of samples) sum += v * v
  return Math.sqrt(sum / samples.length)
}

setInterval(async () => {
  const stat = { from: 'viewer', audioRms: rms() }
  ;(await pc.getStats()).forEach((report) => {
    if (report.type === 'inbound-rtp' && report.kind === 'video') {
      stat.receivedFps = report.framesPerSecond ?? 0
      stat.width = report.frameWidth
      stat.height = report.frameHeight
    }
    if (report.type === 'inbound-rtp' && report.kind === 'audio') {
      stat.inboundAudioLevel = report.audioLevel ?? null
      stat.audioBytes = report.bytesReceived
    }
    if (report.type === 'candidate-pair' && report.nominated && report.currentRoundTripTime != null) {
      stat.rtt = Math.round(report.currentRoundTripTime * 1000)
    }
  })
  send('stat', stat)
}, 1000)

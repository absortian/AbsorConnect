// Lado del PC controlado: captura de la pantalla principal (y del sonido) y envío por WebRTC
const { config, send, onSignal } = window.proto

const pc = new RTCPeerConnection()
pc.onicecandidate = (event) => event.candidate && send('signal', { to: 'viewer', candidate: event.candidate.toJSON() })
onSignal(async (message) => {
  if (message.sdp) await pc.setRemoteDescription(message.sdp)
  if (message.candidate) await pc.addIceCandidate(message.candidate)
})

async function monitorTrack() {
  // Las etiquetas de los dispositivos solo aparecen tras un permiso de audio
  const probe = await navigator.mediaDevices.getUserMedia({ audio: true })
  probe.getTracks().forEach((t) => t.stop())
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput')
  const monitor = devices.find((d) => /monitor/i.test(d.label))
  send('info', { monitorDevices: devices.map((d) => d.label) })
  if (!monitor) return null
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { deviceId: { exact: monitor.deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false }
  })
  return stream.getAudioTracks()[0]
}

async function start() {
  let stream
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: config.audio === 'loopback' })
  } catch (error) {
    send('info', { error: `getDisplayMedia: ${error.name}: ${error.message}` })
    return
  }
  if (config.audio === 'monitor') {
    try {
      const track = await monitorTrack()
      if (track) stream.addTrack(track)
    } catch (error) {
      send('info', { error: `monitor: ${error.name}: ${error.message}` })
    }
  }

  const [video] = stream.getVideoTracks()
  video.contentHint = 'detail'
  send('info', { video: video.getSettings(), audioTracks: stream.getAudioTracks().map((t) => t.label) })

  // Medida en origen del sonido capturado, para distinguir captura silenciosa de pérdida en WebRTC
  let analyser = null
  const samples = new Float32Array(2048)
  if (stream.getAudioTracks().length) {
    const ctx = new AudioContext()
    ctx.resume()
    analyser = ctx.createAnalyser()
    analyser.fftSize = samples.length
    ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks())).connect(analyser)
  }
  const localRms = () => {
    if (!analyser) return null
    analyser.getFloatTimeDomainData(samples)
    let sum = 0
    for (const v of samples) sum += v * v
    return Math.sqrt(sum / samples.length)
  }

  for (const track of stream.getTracks()) {
    const sender = pc.addTrack(track, stream)
    if (track.kind === 'video') {
      const params = sender.getParameters()
      params.degradationPreference = 'maintain-resolution'
      await sender.setParameters(params).catch(() => {})
    }
  }
  await pc.setLocalDescription(await pc.createOffer())
  send('signal', { to: 'viewer', sdp: pc.localDescription.toJSON() })

  setInterval(async () => {
    const stat = { from: 'host', localAudioRms: localRms(), ctxState: analyser?.context.state, audioMuted: stream.getAudioTracks()[0]?.muted }
    ;(await pc.getStats()).forEach((report) => {
      if (report.type === 'media-source' && report.kind === 'video') stat.captureFps = report.framesPerSecond ?? 0
      if (report.type === 'media-source' && report.kind === 'audio') stat.sourceAudioLevel = report.audioLevel ?? null
      if (report.type === 'outbound-rtp' && report.kind === 'video') {
        stat.sentFps = report.framesPerSecond ?? 0
        stat.limitation = report.qualityLimitationReason
      }
    })
    send('stat', stat)
  }, 1000)
}

start()

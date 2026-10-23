// @ts-nocheck
// Solo vídeo artificial; usa autenticación y configurador de vídeo del producto.
import { computeProof, sdpFingerprint } from '../../../src/shared/remote/auth'
import { parseControllerMessage } from '../../../src/shared/remote/protocol'
import { configureVideo, STREAM_SETTINGS } from '../../../src/renderer/host/capture'

window.lab.onOffer(async (offer) => {
  const { iceServers } = await window.lab.config()
  const pc = new RTCPeerConnection({ iceServers })
  let authenticated = false, stream, canvas, drawing, sender, profile = 'balanced'
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24))))
  const key = Uint8Array.from(atob('T/Ffxp4GTajIgqtVcHNXZtYMdnBBQF0IbEnYU8WgO70='), c => c.charCodeAt(0))
  const close = () => { clearInterval(drawing); stream?.getTracks().forEach(t => t.stop()); pc.close() }
  window.addEventListener('beforeunload', close)
  let answer
  let operations = Promise.resolve()
  pc.ondatachannel = ({ channel }) => {
    if (channel.label !== 'control') return
    const send = value => channel.send(JSON.stringify({ v: 1, ...value }))
    channel.onopen = () => send({ type: 'hello', salt: 'c2FsdC1maWpvLTE2LWJ5dA==', iterations: 600000, nonce, hostName: 'Vídeo artificial' })
    channel.onmessage = ({ data }) => {
      operations = operations.then(async () => {
        const message = parseControllerMessage(data)
        if (!message) return
        if (message.type === 'bye') { close(); return }
        if (!authenticated) {
          if (message.type !== 'auth') return
          const expected = await computeProof(key, { nonce, offerFingerprint: sdpFingerprint(offer), answerFingerprint: sdpFingerprint(answer) })
          if (message.proof !== expected) { send({ type: 'auth-result', ok: false, reason: 'wrong_password' }); return }
          authenticated = true
          send({ type: 'auth-result', ok: true })
          canvas = document.createElement('canvas')
          canvas.width = 1920; canvas.height = 1080
          const draw = () => {
            const context = canvas.getContext('2d', { alpha: false }), at = performance.now()
            context.fillStyle = '#eee'; context.fillRect(0, 0, canvas.width, canvas.height)
            context.fillStyle = '#123'; context.font = `${canvas.height / 40}px monospace`
            for (let y = 0; y < canvas.height; y += canvas.height / 24) context.fillText('AbsorConnect · texto artificial 0123456789', 20, y + (at / 25) % 40)
            context.fillStyle = '#46b'; context.fillRect((at / 3) % canvas.width, canvas.height / 3, canvas.width / 5, canvas.height / 3)
          }
          draw(); drawing = setInterval(draw, 1000 / 30)
          stream = canvas.captureStream(30)
          sender = pc.getTransceivers().find(t => t.receiver.track.kind === 'video').sender
          await sender.replaceTrack(stream.getVideoTracks()[0])
          await configureVideo(stream.getVideoTracks()[0], sender, profile)
          send({ type: 'features', clipboard: false, files: false, audio: false, streamQuality: true })
          send({ type: 'stream-quality', profile })
        } else if (message.type === 'set-stream-quality') {
          profile = message.profile
          const settings = STREAM_SETTINGS[profile]
          canvas.width = settings.width ?? 3840; canvas.height = settings.height ?? 2160
          await configureVideo(stream.getVideoTracks()[0], sender, profile)
          send({ type: 'stream-quality', profile })
        }
      }).catch(() => { close() })
    }
  }
  try {
    await pc.setRemoteDescription({ type: 'offer', sdp: offer })
    pc.getTransceivers().forEach(t => { t.direction = 'sendonly' })
    await pc.setLocalDescription(await pc.createAnswer())
    await new Promise(resolve => {
      if (pc.iceGatheringState === 'complete') return resolve()
      const timer = setTimeout(resolve, 6000)
      pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(timer); resolve() } })
    })
    answer = pc.localDescription.sdp
    window.lab.answer({ sdp: answer })
  } catch { close(); window.lab.answer({ error: 'answer_failed' }) }
})
window.lab.ready()

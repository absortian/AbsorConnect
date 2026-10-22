// Controlador de laboratorio: usa la autenticación de producción, con contraseña pública de prueba.
import { computeProof, sdpFingerprint } from '../../../src/shared/remote/auth'
import { CHANNELS, PROTOCOL_VERSION } from '../../../src/shared/remote/protocol'
import vectors from '../../../src/shared/remote/auth-vectors.json'

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const testVector = vectors.vectors.find((vector) => vector.password)

async function deriveKey(hello) {
  if (hello.salt !== testVector.salt || hello.iterations !== testVector.iterations) {
    throw new Error('Parámetros de contraseña distintos del vector público de prueba')
  }
  const password = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(testVector.password), 'PBKDF2', false, ['deriveBits']
  )
  const salt = Uint8Array.from(atob(hello.salt), (character) => character.charCodeAt(0))
  return new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: hello.iterations }, password, 256
  ))
}

async function runCase(name) {
  const pc = new RTCPeerConnection({ iceServers: [] })
  const syntheticVideo = window.lab.syntheticVideo
  const video = document.createElement('video')
  video.muted = true
  if (syntheticVideo) {
    pc.addTransceiver('video', { direction: 'recvonly' })
    pc.ontrack = ({ track }) => {
      video.srcObject = new MediaStream([track])
      video.play().catch(() => {})
    }
  }
  const channel = pc.createDataChannel(CHANNELS.control)
  let offer
  let answer
  let resolveAuth
  let rejectAuth
  let helloCount = 0
  const auth = new Promise((resolve, reject) => { resolveAuth = resolve; rejectAuth = reject })
  // La captura y la entrada no forman parte de este ejecutable; ningún dato del host se solicita.
  channel.onmessage = async ({ data }) => {
    try {
      if (typeof data !== 'string' || data.length > 16384) throw new Error('Mensaje de host demasiado grande')
      const message = JSON.parse(data)
      if (!message || Array.isArray(message) || message.v !== PROTOCOL_VERSION) throw new Error('Mensaje de host inválido')
      if (message.type === 'hello') {
        if (++helloCount !== 1) throw new Error('Reto repetido')
        const key = await deriveKey(message)
        if (syntheticVideo) {
          const stats = await pc.getStats()
          if ([...stats.values()].some((item) => item.type === 'inbound-rtp' && item.kind === 'video' && item.framesDecoded > 0)) {
            throw new Error('Vídeo recibido antes de autenticar')
          }
        }
        let proof = await computeProof(key, {
          nonce: message.nonce,
          offerFingerprint: (name === 'fingerprint-mismatch' ? 'changed ' : '') + sdpFingerprint(offer),
          answerFingerprint: sdpFingerprint(answer)
        })
        if (name === 'wrong-proof') proof = 'A'.repeat(44)
        channel.send(JSON.stringify({ v: 1, type: 'auth', proof }))
      } else if (message.type === 'auth-result') {
        resolveAuth(message)
      } else {
        throw new Error('Datos inesperados antes de terminar la prueba de autenticación')
      }
    } catch (error) { rejectAuth(error) }
  }
  // Evita un rechazo sin atender mientras se intercambia el SDP.
  auth.catch(() => {})
  try {
    await pc.setLocalDescription(await pc.createOffer())
    const gatheringDeadline = Date.now() + 15000
    while (pc.iceGatheringState !== 'complete') {
      if (Date.now() > gatheringDeadline) throw new Error('Venció la recopilación ICE del controlador')
      await delay(50)
    }
    offer = pc.localDescription.sdp
    answer = await window.lab.offer(name, offer)
    await pc.setRemoteDescription({ type: 'answer', sdp: answer })
    let timeout
    const result = await Promise.race([
      auth,
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Sin resultado de autenticación')), 20000) })
    ]).finally(() => clearTimeout(timeout))
    const expected = name === 'correct'
    if (result.ok !== expected || (!expected && result.reason !== 'wrong_password')) {
      throw new Error('Resultado de autenticación inesperado')
    }
    let decodedFrames = 0
    let syntheticColorVerified = false
    if (syntheticVideo) {
      const deadline = Date.now() + (expected ? 15000 : 500)
      while (Date.now() < deadline) {
        const mediaStats = await pc.getStats()
        const inbound = [...mediaStats.values()].find((item) => item.type === 'inbound-rtp' && item.kind === 'video')
        decodedFrames = inbound?.framesDecoded ?? 0
        if (!expected && decodedFrames > 0) throw new Error('Vídeo recibido con autenticación rechazada')
        if (expected && decodedFrames >= 2 && video.readyState >= 2) {
          if (video.videoWidth !== 320 || video.videoHeight !== 180) throw new Error('Resolución artificial incorrecta')
          const canvas = document.createElement('canvas')
          canvas.width = 1; canvas.height = 1
          const context = canvas.getContext('2d', { willReadFrequently: true })
          context.drawImage(video, 160, 90, 1, 1, 0, 0, 1, 1)
          const [red, green, blue] = context.getImageData(0, 0, 1, 1).data
          syntheticColorVerified = red > 180 && green < 80 && blue < 80
          if (!syntheticColorVerified) throw new Error('El contenido decodificado no coincide con el patrón rojo')
          break
        }
        await delay(50)
      }
      if (expected && (!syntheticColorVerified || decodedFrames < 2)) throw new Error('No se recibió vídeo artificial válido')
    }
    const stats = await pc.getStats()
    const transport = [...stats.values()].find((item) => item.type === 'transport' && item.selectedCandidatePairId)
    const pair = transport && stats.get(transport.selectedCandidatePairId)
    const local = pair && stats.get(pair.localCandidateId)
    const remote = pair && stats.get(pair.remoteCandidateId)
    if (!local || !remote || local.candidateType !== 'host' || remote.candidateType !== 'host') {
      throw new Error('No se ha comprobado un par de candidatos de host')
    }
    const connected = pc.connectionState === 'connected'
    channel.send(JSON.stringify({ v: 1, type: 'bye', reason: 'closed' }))
    return await window.lab.result(name, {
      authenticated: result.ok, connected, helloCount,
      candidateTypes: [local.candidateType, remote.candidateType],
      ...(syntheticVideo ? { decodedFrames, syntheticColorVerified } : {})
    })
  } finally { video.pause(); video.srcObject = null; channel.close(); pc.close() }
}

try {
  const results = []
  for (const name of ['correct', 'wrong-proof', 'fingerprint-mismatch']) results.push(await runCase(name))
  await window.lab.done({ ok: true, cases: results })
} catch (error) {
  await window.lab.done({ ok: false, error: String(error) })
}

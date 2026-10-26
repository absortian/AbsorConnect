// Controlador de laboratorio: usa la autenticación de producción, con contraseña pública de prueba.
import { computeProof, sdpFingerprint } from '../../../src/shared/remote/auth'
import { CHANNELS, PROTOCOL_VERSION } from '../../../src/shared/remote/protocol'
import vectors from '../../../src/shared/remote/auth-vectors.json'

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const failureNames = ['worker-stall', 'worker-crash', 'supervisor-stall', 'supervisor-crash']
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
  const pc = new RTCPeerConnection(await window.lab.ice())
  let everConnected = false
  pc.addEventListener('connectionstatechange', () => { if (pc.connectionState === 'connected') everConnected = true })
  const iceErrors = []
  const candidateCounts = {}
  pc.onicecandidateerror = ({ errorCode }) => { if (iceErrors.length < 16) iceErrors.push(errorCode) }
  pc.onicecandidate = ({ candidate }) => {
    if (candidate) candidateCounts[candidate.type] = (candidateCounts[candidate.type] ?? 0) + 1
  }
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
  const input = window.lab.nativeFixture ? pc.createDataChannel(CHANNELS.input) : null
  const fixedInput = [
    { type:'button', button:0, down:true }, { type:'button', button:0, down:false },
    { type:'key', code:'KeyA', down:true }, { type:'key', code:'KeyA', down:false }
  ]
  let preAuthInputSent = false
  let lockedInputSent = false
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
        if (input) {
          const deadline = Date.now() + 5000
          while (input.readyState !== 'open') {
            if (Date.now() > deadline) throw new Error('Canal input no disponible')
            await delay(10)
          }
          for (const event of fixedInput) input.send(JSON.stringify(event))
          preAuthInputSent = true
          await delay(200)
        }
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
        if (input && name === 'linux-locked' && message.ok && input.readyState === 'open') {
          for (const event of fixedInput) input.send(JSON.stringify(event))
          lockedInputSent = true
        }
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
    const gatheringDeadline = Date.now() + (window.lab.relayOnly ? 30000 : 15000)
    while (pc.iceGatheringState !== 'complete' && !(window.lab.relayOnly && candidateCounts.relay > 0)) {
      if (Date.now() > gatheringDeadline) throw new Error(`Venció la recopilación ICE del controlador: ${JSON.stringify({ candidateCounts, iceErrors })}`)
      await delay(50)
    }
    // No se exige finalizar toda la búsqueda si ya hay relé utilizable; se verifica el par real después.
    if (window.lab.relayOnly) await delay(500)
    offer = pc.localDescription.sdp
    answer = await window.lab.offer(name, offer)
    await pc.setRemoteDescription({ type: 'answer', sdp: answer })
    let timeout
    const result = await Promise.race([
      auth,
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Sin resultado de autenticación')), 20000) })
    ]).finally(() => clearTimeout(timeout))
    const expected = !['wrong-proof', 'fingerprint-mismatch'].includes(name)
    const expectedVideo = expected && name !== 'linux-locked'
    if (result.ok !== expected || (!expected && result.reason !== 'wrong_password')) {
      throw new Error('Resultado de autenticación inesperado')
    }
    let decodedFrames = 0
    let syntheticColorVerified = false
    let nativeGreenVerified = false
    if (syntheticVideo) {
      const deadline = Date.now() + (expectedVideo ? 15000 : 500)
      while (Date.now() < deadline) {
        const mediaStats = await pc.getStats()
        const inbound = [...mediaStats.values()].find((item) => item.type === 'inbound-rtp' && item.kind === 'video')
        decodedFrames = inbound?.framesDecoded ?? 0
        if (!expectedVideo && decodedFrames > 0) throw new Error('Vídeo recibido con autenticación rechazada o contexto bloqueado')
        if (expectedVideo && decodedFrames >= 2 && video.readyState >= 2) {
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
      if (expectedVideo && (!syntheticColorVerified || decodedFrames < 2)) throw new Error('No se recibió vídeo válido')
    }
    if (input && expectedVideo) {
      for (const event of [{ type:'text', text:'rejected' }, { type:'key', code:'KeyZ', down:true }, ...fixedInput]) input.send(JSON.stringify(event))
      const deadline = Date.now() + 10000
      const canvas = document.createElement('canvas')
      canvas.width = 1; canvas.height = 1
      const context = canvas.getContext('2d', { willReadFrequently:true })
      while (Date.now() < deadline) {
        context.drawImage(video, 160, 90, 1, 1, 0, 0, 1, 1)
        const [red, green, blue] = context.getImageData(0, 0, 1, 1).data
        if (green > 180 && red < 80 && blue < 80) { nativeGreenVerified = true; break }
        await delay(50)
      }
      if (!nativeGreenVerified) throw new Error('La entrada remota no produjo el frame verde nativo')
      // Duplicados y otra entrada no deben generar un segundo pulso del SO.
      for (const event of fixedInput) input.send(JSON.stringify(event))
      await delay(150)
    }
    if (window.lab.apiSignaling && name === 'correct') await window.lab.busy()
    const stats = await pc.getStats()
    const transport = [...stats.values()].find((item) => item.type === 'transport' && item.selectedCandidatePairId)
    const pair = transport && stats.get(transport.selectedCandidatePairId)
    const local = pair && stats.get(pair.localCandidateId)
    const remote = pair && stats.get(pair.remoteCandidateId)
    if (!local || !remote || local.candidateType !== (window.lab.relayOnly ? 'relay' : 'host') || (!window.lab.relayController && !(window.lab.nativeFixture ? ['host', 'prflx'].includes(remote.candidateType) : remote.candidateType === (window.lab.relayOnly ? 'relay' : 'host')))) {
      throw new Error('No se ha comprobado el par de candidatos exigido')
    }
    const connected = name === 'linux-locked' ? everConnected : pc.connectionState === 'connected'
    let cutAfterFaultMilliseconds
    let channelClosedAfterFault = false
    let framesStoppedAfterFault
    if (name === 'linux-locked') {
      if (channel.readyState !== 'closed') {
        let timeout
        await Promise.race([new Promise((resolve) => channel.addEventListener('close', resolve, { once:true })), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('El contexto bloqueado no cortó el canal')), 3000) })]).finally(() => clearTimeout(timeout))
      }
      channelClosedAfterFault = true
    } else if (window.lab.supervised && failureNames.includes(name)) {
      await window.lab.fault(name)
      // UDP no envía un cierre DTLS al morir abruptamente. Comprobar proceso y
      // ausencia de nuevos fotogramas, sin confundirlo con cierre del canal remoto.
      await delay(500)
      const frames = async () => [...(await pc.getStats()).values()].find((item) => item.type === 'inbound-rtp' && item.kind === 'video')?.framesDecoded ?? 0
      const before = await frames()
      await delay(1200)
      framesStoppedAfterFault = before === await frames()
      if (!framesStoppedAfterFault) throw new Error('El vídeo siguió llegando tras morir el extremo')
    } else
    if (window.lab.agentBridge && ['api-revoked', 'api-cut'].includes(name)) {
      const closed = new Promise((resolve) => channel.addEventListener('close', resolve, { once: true }))
      const started = performance.now()
      await window.lab.fault(name)
      let timeout
      await Promise.race([closed, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('El canal no se cerró tras el fallo')), 31000) })]).finally(() => clearTimeout(timeout))
      cutAfterFaultMilliseconds = Math.round(performance.now() - started)
      channelClosedAfterFault = true
      if (cutAfterFaultMilliseconds > (name === 'api-revoked' ? 8000 : 30000)) throw new Error('El corte excede el plazo de laboratorio')
    } else channel.send(JSON.stringify({ v: 1, type: 'bye', reason: 'closed' }))
    return await window.lab.result(name, {
      authenticated: result.ok, connected, helloCount,
      candidateTypes: [local.candidateType, remote.candidateType],
      relayProtocol: local.relayProtocol ?? null,
      ...(window.lab.agentBridge ? { channelClosedAfterFault, cutAfterFaultMilliseconds, framesStoppedAfterFault } : {}),
      ...(syntheticVideo ? { decodedFrames, syntheticColorVerified } : {}),
      ...(input ? { preAuthInputSent, nativeGreenVerified, lockedInputSent } : {})
    })
  } finally { video.pause(); video.srcObject = null; input?.close(); channel.close(); pc.close() }
}

try {
  let rendererCredentialsDenied
  if (window.lab.agentBridge) {
    if ((await fetch('absor-agent-lab://probe/agent-manifest.json')).status !== 404) throw new Error('Ruta privada expuesta al visor')
    const probe = await window.lab.credentialProbe()
    let fileDenied = false
    try { await fetch(probe) } catch { fileDenied = true }
    if (!fileDenied) throw new Error('El visor puede leer archivos locales')
    rendererCredentialsDenied = true
  }
  const results = []
  for (const name of (window.lab.agentBridge ? ['correct', 'wrong-proof', 'fingerprint-mismatch', 'api-revoked', 'api-cut', ...(window.lab.nativeFixture ? ['linux-locked'] : []), ...(window.lab.supervised ? failureNames : [])] : ['correct', 'wrong-proof', 'fingerprint-mismatch'])) results.push(await runCase(name))
  await window.lab.done({ ok: true, cases: results, ...(window.lab.agentBridge ? { rendererCredentialsDenied } : {}) })
} catch (error) {
  await window.lab.done({ ok: false, error: String(error) })
}

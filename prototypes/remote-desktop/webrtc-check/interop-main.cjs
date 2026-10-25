const { app, BrowserWindow, ipcMain, protocol, session } = require('electron')
const { pathToFileURL } = require('node:url')
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { setTimeout: delay } = require('node:timers/promises')
const work = process.argv.find((arg) => arg.startsWith('--lab-work='))?.slice(11)
const binary = process.argv.find((arg) => arg.startsWith('--lab-binary='))?.slice(13)
const agentBridge = process.argv.includes('--lab-agent-bridge')
const agentManifest = agentBridge ? JSON.parse(fs.readFileSync(path.join(work, 'agent-manifest.json'), 'utf8')) : null
const supervisor = process.argv.find((arg) => arg.startsWith('--lab-supervisor='))?.slice(17)
const failureCommands = { 'worker-stall': 'S', 'worker-crash': 'K', 'supervisor-stall': 'B', 'supervisor-crash': 'X' }
const caseNames = agentBridge ? ['correct', 'wrong-proof', 'fingerprint-mismatch', 'api-revoked', 'api-cut', ...(supervisor ? Object.keys(failureCommands) : [])] : ['correct', 'wrong-proof', 'fingerprint-mismatch']
if (agentBridge) protocol.registerSchemesAsPrivileged([{ scheme: 'absor-agent-lab', privileges: { standard: true, secure: true, supportFetchAPI: true } }])
const syntheticVideo = process.argv.includes('--lab-synthetic-video')
if (!work || !binary) process.exit(64)
const relayOnly = process.argv.includes('--lab-relay-only')
const relayController = process.argv.includes('--lab-relay-controller')
const turnPath = path.join(work, 'turn-config.json')
const ice = relayOnly ? { ...JSON.parse(fs.readFileSync(turnPath, 'utf8')), iceTransportPolicy: 'relay' } : { iceServers: [], iceTransportPolicy: 'all' }
const nativeIcePath = path.join(work, 'native-ice.json')
if (relayOnly) fs.writeFileSync(nativeIcePath, JSON.stringify({ iceServers: ice.iceServers, iceTransportPolicy: relayController ? 'all' : 'relay' }), { mode: 0o600, flag: 'wx' })
const cases = new Map()
let window
app.setPath('userData', path.join(work, 'electron-profile'))
app.setName('Absor WebRTC Lab')

function validate(event, name) {
  if (event.sender !== window?.webContents || !caseNames.includes(name)) {
    throw new Error('Solicitud de prueba no autorizada')
  }
}

ipcMain.handle('lab-credential-probe', (event) => {
  if (!agentBridge || event.sender !== window?.webContents) throw new Error('Emisor inválido')
  const file = path.join(work, 'renderer-denial-probe.txt')
  fs.writeFileSync(file, 'Public marker; no secrets', { mode: 0o600 })
  return pathToFileURL(file).href
})

ipcMain.handle('lab-ice', (event) => {
  if (event.sender !== window?.webContents) throw new Error('Emisor inválido')
  return ice
})

ipcMain.handle('lab-fault', async (event, name) => {
  validate(event, name)
  if (supervisor && Object.hasOwn(failureCommands, name)) {
    const state = cases.get(name)
    if (!state || state.exited || state.faultSent) throw new Error('Proceso o fallo inválido')
    state.faultSent = true
    const started = performance.now()
    state.child.stdin.write(failureCommands[name] + '\n')
    await Promise.race([state.done, delay(8000).then(() => { throw new Error('El proceso sobrevivió al watchdog') })])
    state.processCutMilliseconds = Math.round(performance.now() - started)
    return
  }
  const entry = agentManifest?.[name]
  if (!entry || !['api-revoked', 'api-cut'].includes(name)) throw new Error('Fallo no permitido')
  const url = new URL(entry.faultUrl)
  if (url.hostname !== '127.0.0.1' || url.protocol !== 'http:' || !url.port || url.pathname !== `/fault/${name}` || url.search || url.hash || url.username || url.password) throw new Error('Destino no local')
  const response = await fetch(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(6000) })
  if (response.status !== 204) throw new Error('No se pudo aplicar el fallo local')
})

ipcMain.handle('lab-offer', async (event, name, offer) => {
  validate(event, name)
  if (cases.has(name) || typeof offer !== 'string' || Buffer.byteLength(offer) > 262144) {
    throw new Error('Oferta duplicada o inválida')
  }
  const directory = path.join(work, name)
  fs.mkdirSync(directory, { mode: 0o700 })
  const offerPath = path.join(directory, 'offer.sdp')
  const answerPath = path.join(directory, 'answer.sdp')
  fs.writeFileSync(offerPath, offer, { mode: 0o600, flag: 'wx' })
  let agentPath
  if (agentBridge) {
    const entry = agentManifest[name]
    const origin = new URL(entry.origin)
    if (origin.hostname !== '127.0.0.1' || origin.protocol !== 'http:' || !origin.port || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password || !/^acg_[A-Za-z0-9_-]{43}$/.test(entry.credential)) throw new Error('Configuración de agente inválida')
    const stateDirectory = path.join(directory, 'rust-agent-state')
    fs.mkdirSync(stateDirectory, { mode: 0o700 })
    fs.writeFileSync(path.join(stateDirectory, 'absor-webrtc-lab'), 'synthetic-only', { mode: 0o600, flag: 'wx' })
    fs.writeFileSync(path.join(stateDirectory, 'attempts.json'), JSON.stringify({ schema: 1, failures: [], locked_until: null, last_seen: 0 }), { mode: 0o600, flag: 'wx' })
    agentPath = path.join(directory, 'agent-config.json')
    fs.writeFileSync(agentPath, JSON.stringify({ origin: entry.origin, credential: entry.credential, stateDirectory }), { mode: 0o600, flag: 'wx' })
  }
  const reportPath = path.join(directory, 'supervisor-events.jsonl')
  const child = spawn(supervisor ?? binary, [...(supervisor ? [reportPath, binary] : []), offerPath, answerPath, ...(relayOnly ? [nativeIcePath] : []), ...(agentPath ? [agentPath] : [])], { stdio: [supervisor ? 'pipe' : 'ignore', 'pipe', 'pipe'] })
  child.stdin?.on('error', () => {})
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (data) => { stdout = (stdout + data).slice(-16384) })
  child.stderr.on('data', (data) => { stderr = (stderr + data).slice(-16384) })
  const state = { child, exited: false, code: null, summary: null, reportPath }
  state.done = new Promise((resolve) => {
    child.on('error', () => { state.exited = true; state.code = -1; resolve() })
    child.on('close', (code) => {
      state.exited = true
      state.code = code
      try { state.summary = JSON.parse(stdout.trim()) } catch {}
      fs.writeFileSync(path.join(directory, 'native-stderr.txt'), stderr, { mode: 0o600 })
      resolve()
    })
  })
  cases.set(name, state)
  const deadline = Date.now() + 25000
  while (!fs.existsSync(answerPath)) {
    if (state.exited) throw new Error(`El extremo nativo terminó con código ${state.code}`)
    if (Date.now() > deadline) throw new Error('Sin respuesta SDP del extremo nativo')
    await delay(50)
  }
  const answer = fs.readFileSync(answerPath, 'utf8')
  if (Buffer.byteLength(answer) > 262144) throw new Error('Respuesta SDP demasiado grande')
  return answer
})

ipcMain.handle('lab-result', async (event, name, controller) => {
  validate(event, name)
  const state = cases.get(name)
  if (!state) throw new Error('Caso inexistente')
  await state.done
  const supervision = supervisor ? fs.readFileSync(state.reportPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line)) : null
  if (supervisor && Object.hasOwn(failureCommands, name)) {
    const ended = supervision.some((item) => item.event === 'cut' && item.workerReaped)
    const lostParent = name === 'supervisor-crash' && state.code === 73
    if (!state.faultSent || (!ended && !lostParent && name !== 'worker-crash') || state.code === 0 || !controller.authenticated || !controller.connected || controller.decodedFrames < 2 || !controller.syntheticColorVerified || !controller.framesStoppedAfterFault || state.processCutMilliseconds > (name === 'supervisor-stall' ? 6500 : 3500)) throw new Error('El watchdog no confirmó el corte')
    if (name === 'supervisor-stall' && !supervision.some((item) => item.workerCode === 72 && Number.isFinite(item.workerPipeClosedAfterFaultMilliseconds) && item.workerPipeClosedAfterFaultMilliseconds < 3500)) throw new Error('El trabajador sobrevivió al supervisor bloqueado')
    return { name, supervisor: { events: supervision.map(({ workerPid, supervisorPid, ...value }) => value), exitCode: state.code, processCutMilliseconds: state.processCutMilliseconds, processOutputClosed: true }, controller }
  }
  if (state.code !== 0 || !state.summary?.dtlsConnected || !controller.connected ||
      state.summary.authenticated !== controller.authenticated ||
      state.summary.authenticated !== !['wrong-proof', 'fingerprint-mismatch'].includes(name) ||
      state.summary.captureStarted || state.summary.inputEnabled || state.summary.relayOnly !== (relayOnly && !relayController)) {
    throw new Error('El extremo nativo y el controlador no concuerdan')
  }
  if (agentBridge && (!state.summary.rustAuthentication || state.summary.apiCutCode !== (name === 'api-revoked' ? -2 : name === 'api-cut' ? -1 : 0))) throw new Error('Corte del agente no confirmado')
  if (syntheticVideo && (!['wrong-proof', 'fingerprint-mismatch'].includes(name)
    ? !(state.summary.syntheticVideoFrames > 0 && controller.decodedFrames >= 2 && controller.syntheticColorVerified)
    : state.summary.syntheticVideoFrames !== 0 || controller.decodedFrames !== 0)) {
    throw new Error('El vídeo artificial no respeta el resultado de autenticación')
  }
  if (supervisor && !supervision.some((item) => item.event === 'exited' && item.workerCode === 0)) throw new Error('El supervisor no recogió al trabajador')
  return { name, native: state.summary, controller, ...(supervisor ? { supervised: true } : {}) }
})

ipcMain.handle('lab-done', (event, result) => {
  if (event.sender !== window?.webContents) throw new Error('Emisor inválido')
  const report = { ...result, electron: process.versions.electron, chromium: process.versions.chrome,
    videoTested: false, rustAuthenticationTested: agentBridge, apiRenewalTested: agentBridge && result.ok, supervisorTested: Boolean(supervisor) && result.ok, syntheticVideoTested: syntheticVideo, turnTested: relayOnly && result.ok, relayPolicy: relayOnly ? (relayController ? 'controller' : 'both') : 'none', mobileTested: false, readyForUnattended: false }
  fs.writeFileSync(path.join(work, 'interop-results.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 })
  console.log(JSON.stringify(report))
  setImmediate(() => { cleanup(); app.exit(result.ok ? 0 : 1) })
})

function cleanup() { for (const { child, exited } of cases.values()) { if (!exited) child.kill() } }
app.on('will-quit', cleanup)
app.whenReady().then(async () => {
  app.dock?.hide()
  if (agentBridge) {
    // El visor solo recibe dos recursos públicos; nunca archivos de configuración.
    protocol.handle('absor-agent-lab', (request) => {
      const url = new URL(request.url)
      const file = url.hostname === 'probe' && !url.search && !url.hash && ({ '/index.html': 'index.html', '/renderer.js': 'renderer.js' })[url.pathname]
      if (!file) return new Response('', { status: 404 })
      return new Response(fs.readFileSync(path.join(work, file)), { headers: { 'Content-Type': file.endsWith('.js') ? 'text/javascript' : 'text/html' } })
    })
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['file://*/*', 'http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }))
  }
  window = new BrowserWindow({ show: false, webPreferences: {
    preload: path.join(__dirname, 'interop-preload.cjs'), contextIsolation: true,
    nodeIntegration: false, sandbox: true, backgroundThrottling: false,
    autoplayPolicy: 'no-user-gesture-required',
    additionalArguments: [...(supervisor ? ['--lab-supervised'] : []), ...(agentBridge ? ['--lab-agent-bridge'] : []), ...(syntheticVideo ? ['--lab-synthetic-video'] : []), ...(relayOnly ? ['--lab-relay-only'] : []), ...(relayController ? ['--lab-relay-controller'] : [])]
  } })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  if (agentBridge) {
    window.webContents.on('will-navigate', (event, url) => { if (url !== 'absor-agent-lab://probe/index.html') event.preventDefault() })
    await window.loadURL('absor-agent-lab://probe/index.html')
  } else await window.loadFile(path.join(work, 'index.html'))
})
setTimeout(() => { cleanup(); app.exit(2) }, 150000).unref()

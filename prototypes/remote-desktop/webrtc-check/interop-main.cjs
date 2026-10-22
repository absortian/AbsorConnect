const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { setTimeout: delay } = require('node:timers/promises')
const work = process.argv.find((arg) => arg.startsWith('--lab-work='))?.slice(11)
const binary = process.argv.find((arg) => arg.startsWith('--lab-binary='))?.slice(13)
const syntheticVideo = process.argv.includes('--lab-synthetic-video')
if (!work || !binary) process.exit(64)
const cases = new Map()
let window
app.setPath('userData', path.join(work, 'electron-profile'))
app.setName('Absor WebRTC Lab')

function validate(event, name) {
  if (event.sender !== window?.webContents || !['correct', 'wrong-proof', 'fingerprint-mismatch'].includes(name)) {
    throw new Error('Solicitud de prueba no autorizada')
  }
}

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
  const child = spawn(binary, [offerPath, answerPath], { stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (data) => { stdout = (stdout + data).slice(-16384) })
  child.stderr.on('data', (data) => { stderr = (stderr + data).slice(-16384) })
  const state = { child, exited: false, code: null, summary: null }
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
  if (state.code !== 0 || !state.summary?.dtlsConnected || !controller.connected ||
      state.summary.authenticated !== controller.authenticated ||
      state.summary.authenticated !== (name === 'correct') ||
      state.summary.captureStarted || state.summary.inputEnabled) {
    throw new Error('El extremo nativo y el controlador no concuerdan')
  }
  if (syntheticVideo && (name === 'correct'
    ? !(state.summary.syntheticVideoFrames > 0 && controller.decodedFrames >= 2 && controller.syntheticColorVerified)
    : state.summary.syntheticVideoFrames !== 0 || controller.decodedFrames !== 0)) {
    throw new Error('El vídeo artificial no respeta el resultado de autenticación')
  }
  return { name, native: state.summary, controller }
})

ipcMain.handle('lab-done', (event, result) => {
  if (event.sender !== window?.webContents) throw new Error('Emisor inválido')
  const report = { ...result, electron: process.versions.electron, chromium: process.versions.chrome,
    videoTested: false, syntheticVideoTested: syntheticVideo, turnTested: false, mobileTested: false, readyForUnattended: false }
  fs.writeFileSync(path.join(work, 'interop-results.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 })
  console.log(JSON.stringify(report))
  setImmediate(() => { cleanup(); app.exit(result.ok ? 0 : 1) })
})

function cleanup() { for (const { child, exited } of cases.values()) { if (!exited) child.kill() } }
app.on('will-quit', cleanup)
app.whenReady().then(async () => {
  app.dock?.hide()
  window = new BrowserWindow({ show: false, webPreferences: {
    preload: path.join(__dirname, 'interop-preload.cjs'), contextIsolation: true,
    nodeIntegration: false, sandbox: true, backgroundThrottling: false,
    autoplayPolicy: 'no-user-gesture-required',
    additionalArguments: syntheticVideo ? ['--lab-synthetic-video'] : []
  } })
  await window.loadFile(path.join(work, 'index.html'))
})
setTimeout(() => { cleanup(); app.exit(2) }, 90000).unref()

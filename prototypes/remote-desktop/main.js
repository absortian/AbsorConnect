// Prototipos de riesgo del cambio add-remote-desktop (grupo 1 de tasks.md). No es parte de la app.
//
//   electron .                                  # batería completa (lo que se usa al abrir el paquete)
//   electron . --mode=capture [--seconds=300] [--audio=none|loopback|monitor] [--tone]
//   electron . --mode=input
//   electron . --mode=pbkdf2 [--iterations=600000]
//
// Cada medida sale como una línea JSON en stdout. Al terminar, el resumen se guarda en
// Descargas/absor-remote-prototype-<sistema>.json y se muestra en una ventana.
const { app, BrowserWindow, clipboard, desktopCapturer, ipcMain, screen, session, systemPreferences } = require('electron')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')

const args = Object.fromEntries(
  process.argv
    .slice(1)
    .filter((a) => a.startsWith('--') && a.includes('='))
    .map((a) => a.slice(2).split('='))
)
const flags = new Set(process.argv.filter((a) => a === '--tone'))

const results = {
  platform: process.platform,
  arch: process.arch,
  osRelease: os.release(),
  electron: process.versions.electron,
  packaged: app.isPackaged,
  sessionType: process.env.XDG_SESSION_TYPE || null,
  steps: []
}

function log(entry) {
  console.log(JSON.stringify(entry))
}

function record(step) {
  results.steps.push(step)
  log({ result: step })
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function hiddenWindow(file, config) {
  const win = new BrowserWindow({
    show: false,
    width: 640,
    height: 360,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      // Sin esto Chromium ralentiza los temporizadores y la captura de las ventanas ocultas (D7)
      backgroundThrottling: false,
      // Sin gesto del usuario, un AudioContext nace en pausa y solo lee ceros
      autoplayPolicy: 'no-user-gesture-required',
      additionalArguments: [`--proto-config=${JSON.stringify(config)}`]
    }
  })
  win.loadFile(path.join(__dirname, file))
  return win
}

// Ventana pequeña siempre encima que se mueve sin parar (para que la pantalla cambie y el
// codificador tenga algo que enviar) y, con --tone, suena a volumen bajo.
function markerWindow(config) {
  const area = screen.getPrimaryDisplay().workArea
  const win = new BrowserWindow({
    width: 180,
    height: 48,
    x: area.x + area.width - 200,
    y: area.y + area.height - 68,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    focusable: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
      additionalArguments: [`--proto-config=${JSON.stringify(config)}`]
    }
  })
  win.loadFile(path.join(__dirname, 'marker.html'))
  return win
}

function percentile(values, p) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
}

function average(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
}

// 1.1 y 1.2: captura en una ventana oculta enviada por WebRTC local a otra ventana oculta.
async function runCapture({ seconds, audio, tone }) {
  session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      const sources = await desktopCapturer.getSources({ types: ['screen'] })
      const primaryId = String(screen.getPrimaryDisplay().id)
      const source = sources.find((s) => s.display_id === primaryId) ?? sources[0]
      log({ sources: sources.map((s) => ({ id: s.id, display_id: s.display_id, name: s.name })), chosen: source?.id })
      if (!source) return callback({})
      callback(audio === 'loopback' ? { video: source, audio: 'loopback' } : { video: source })
    },
    { useSystemPicker: false }
  )

  const config = { audio, tone }
  const marker = markerWindow(config)
  const host = hiddenWindow('host.html', config)
  const viewer = hiddenWindow('viewer.html', config)
  const windows = { host, viewer }

  const samples = { captureFps: [], sentFps: [], receivedFps: [], audioRms: [], localAudioRms: [], rtt: [] }
  let info = {}
  const errors = []

  const onSignal = (_event, message) => windows[message.to]?.webContents.send('signal', message)
  const onStat = (_event, stat) => {
    log({ stat })
    if (stat.from === 'host') {
      if (stat.captureFps != null) samples.captureFps.push(stat.captureFps)
      if (stat.sentFps != null) samples.sentFps.push(stat.sentFps)
      if (stat.limitation) info.limitation = stat.limitation
      if (stat.localAudioRms != null) samples.localAudioRms.push(stat.localAudioRms)
    } else {
      if (stat.receivedFps != null) samples.receivedFps.push(stat.receivedFps)
      if (stat.audioRms != null) samples.audioRms.push(stat.audioRms)
      if (stat.rtt != null) samples.rtt.push(stat.rtt)
      if (stat.width) info.resolution = `${stat.width}x${stat.height}`
    }
  }
  const onInfo = (_event, data) => {
    log({ info: data })
    if (data.error) errors.push(data.error)
    info = { ...info, ...data, error: undefined }
  }
  ipcMain.on('signal', onSignal)
  ipcMain.on('stat', onStat)
  ipcMain.on('info', onInfo)

  await wait(seconds * 1000)

  ipcMain.off('signal', onSignal)
  ipcMain.off('stat', onStat)
  ipcMain.off('info', onInfo)
  for (const win of [host, viewer, marker]) if (!win.isDestroyed()) win.destroy()

  // Los primeros 5 s son de arranque (negociación, primer fotograma clave)
  const steady = (values) => values.slice(5)
  const received = steady(samples.receivedFps)
  const rms = steady(samples.audioRms)
  record({
    step: audio === 'none' ? 'capture' : `capture-audio-${audio}`,
    seconds,
    tone,
    errors,
    resolution: info.resolution ?? null,
    videoTrack: info.video ?? null,
    audioTracks: info.audioTracks ?? [],
    monitorDevices: info.monitorDevices,
    limitation: info.limitation ?? null,
    captureFps: { avg: average(steady(samples.captureFps)), p5: percentile(steady(samples.captureFps), 5) },
    receivedFps: { avg: average(received), p5: percentile(received, 5), min: received.length ? Math.min(...received) : null },
    rttMs: average(steady(samples.rtt)),
    audio:
      audio === 'none'
        ? null
        : {
            maxRms: rms.length ? Math.max(...rms) : null,
            maxLocalRms: samples.localAudioRms.length ? Math.max(...steady(samples.localAudioRms)) : null,
            secondsWithSound: rms.filter((v) => v > 0.005).length,
            secondsMeasured: rms.length
          }
  })
}

// 1.3: mover el ratón con koffi y volver a dejarlo donde estaba.
async function runInput() {
  const step = { step: 'input', ok: false }
  try {
    if (process.platform === 'darwin') {
      step.accessibility = systemPreferences.isTrustedAccessibilityClient(true)
    }
    const input = require('./input')
    step.koffi = input.koffiInfo()
    const before = screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(before)
    const target = {
      x: Math.min(display.bounds.x + display.bounds.width - 10, before.x + 40),
      y: Math.min(display.bounds.y + display.bounds.height - 10, before.y + 40)
    }
    input.moveMouse(target, display)
    await wait(150)
    const after = screen.getCursorScreenPoint()
    step.afterX11 = input.queryPointer()
    input.moveMouse(before, display)
    step.before = before
    step.target = target
    step.after = after
    step.physicalSent = input.sentPhysical
    step.hasDipToScreenPoint = typeof screen.dipToScreenPoint === 'function'
    step.scaleFactor = display.scaleFactor
    // En X11, screen.getCursorScreenPoint() puede devolver una posición antigua cuando el puntero
    // lo mueve otro proceso: allí se comprueba con XQueryPointer en píxeles físicos
    const [sent] = input.sentPhysical
    step.ok = step.afterX11
      ? Math.abs(step.afterX11.x - sent.x) <= 1 && Math.abs(step.afterX11.y - sent.y) <= 1
      : Math.abs(after.x - target.x) <= 2 && Math.abs(after.y - target.y) <= 2
  } catch (error) {
    step.error = String(error?.stack || error)
  }
  record(step)
}

// 1.4: PBKDF2-HMAC-SHA256 en WebCrypto (renderer) y en Node (proceso principal).
async function runPbkdf2({ iterations }) {
  const node = []
  for (let i = 0; i < 3; i++) {
    const start = performance.now()
    crypto.pbkdf2Sync('contraseña de prueba', crypto.randomBytes(16), iterations, 32, 'sha256')
    node.push(Math.round(performance.now() - start))
  }
  const win = hiddenWindow('pbkdf2.html', { iterations })
  const webcrypto = await new Promise((resolve) => ipcMain.once('pbkdf2', (_event, times) => resolve(times)))
  win.destroy()
  record({ step: 'pbkdf2', iterations, nodeMs: node, webcryptoMs: webcrypto })
}

async function showResults() {
  const file = path.join(app.getPath('downloads'), `absor-remote-prototype-${process.platform}-${process.arch}.json`)
  const text = JSON.stringify(results, null, 2)
  fs.writeFileSync(file, text)
  log({ summary: results, file })
  if (args.mode) return
  const win = new BrowserWindow({ width: 760, height: 640, title: 'Absor Remote Prototype' })
  ipcMain.handleOnce('copy-results', () => clipboard.writeText(text))
  const html = `<!doctype html><meta charset="utf-8"><title>Resultados</title>
    <body style="font:13px system-ui;margin:16px">
    <p>Resultados guardados en <b>${file}</b>. Envía ese fichero o copia el texto.</p>
    <pre style="white-space:pre-wrap;background:#f3f3f3;padding:12px">${text.replace(/</g, '&lt;')}</pre></body>`
  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  await new Promise((resolve) => win.on('closed', resolve))
}

async function main() {
  await app.whenReady()
  const mode = args.mode ?? 'suite'
  const seconds = Number(args.seconds ?? (mode === 'suite' ? 60 : 300))
  const iterations = Number(args.iterations ?? 600000)

  if (mode === 'input' || mode === 'suite') await runInput()
  if (mode === 'pbkdf2' || mode === 'suite') await runPbkdf2({ iterations })
  if (mode === 'capture') await runCapture({ seconds, audio: args.audio ?? 'none', tone: flags.has('--tone') })
  if (mode === 'suite') {
    await runCapture({ seconds, audio: 'loopback', tone: true })
    if (process.platform === 'linux') await runCapture({ seconds: 20, audio: 'monitor', tone: true })
  }
  await showResults()
  app.quit()
}

// Sin ventanas visibles la app no debe terminar a mitad de una prueba
app.on('window-all-closed', () => {})
main().catch((error) => {
  console.error(error)
  app.exit(1)
})

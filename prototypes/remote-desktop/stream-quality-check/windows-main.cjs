// Captura real del escritorio de una VM Windows: únicamente métricas, sin imágenes guardadas.
const { app, BrowserWindow, desktopCapturer, ipcMain, screen, session } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const work = process.argv.find(a => a.startsWith('--work='))?.slice(7)
if (process.platform !== 'win32' || !work || !path.isAbsolute(work) || !fs.statSync(work).isDirectory()) process.exit(64)
const output = path.join(work, 'windows-capture-result.json')
if (fs.existsSync(output)) process.exit(64)
app.setPath('userData', path.join(work, 'electron-profile'))
app.setName('AbsorConnect Windows Capture Lab')
let runner, pattern, completed = false
function finish(result) {
  if (completed) return
  completed = true
  fs.writeFileSync(output, JSON.stringify({ ...result, electron: process.versions.electron,
    chromium: process.versions.chrome, architecture: process.arch, platform: process.platform,
    realDisplayCapture: true, virtualMachineOnly: true, physicalWindowsTested: false,
    systemInputTested: false, authenticationTested: false, remoteNetworkTested: false }, null, 2), { flag: 'wx' })
  app.exit(result.error ? 1 : 0)
}
ipcMain.on('lab-result', (event, result) => {
  if (event.sender === runner?.webContents) finish(result)
})
app.whenReady().then(async () => {
  const display = screen.getPrimaryDisplay()
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
    callback(contents === runner?.webContents && ['media', 'display-capture'].includes(permission))
  })
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    if (request.frame !== runner?.webContents.mainFrame || !request.videoRequested || request.audioRequested) return callback({})
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
      const source = sources.find(s => s.display_id === String(display.id))
      callback(source ? { video: source } : {})
    } catch { callback({}) }
  })
  // Ventana propia con contenido artificial. No se automatizan otras aplicaciones.
  pattern = new BrowserWindow({ ...display.bounds, fullscreen: true, frame: false,
    webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true, backgroundThrottling: false } })
  await pattern.loadFile(path.join(__dirname, 'out/windows-pattern.html'))
  runner = new BrowserWindow({ show: false, webPreferences: {
    preload: path.join(__dirname, 'preload.cjs'), sandbox: true, nodeIntegration: false,
    contextIsolation: true, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required'
  } })
  await runner.loadFile(path.join(__dirname, 'out/windows-capture.html'))
}).catch(error => finish({ error: String(error) }))
setTimeout(() => finish({ error: 'Tiempo máximo del diagnóstico agotado' }), 100000).unref()

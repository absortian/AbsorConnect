const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const work = process.argv.find(a => a.startsWith('--work='))?.slice(7)
if (!work || !path.isAbsolute(work) || !fs.statSync(work).isDirectory()) process.exit(64)
const route = process.argv.find(a => a.startsWith('--route='))?.slice(8) || 'direct'
if (!['direct', 'limited', 'udp', 'tls'].includes(route)) process.exit(64)
const config = ['direct', 'limited'].includes(route) ? { iceServers: [] } : JSON.parse(fs.readFileSync(path.join(work, `turn-${route}.json`), 'utf8'))
let window
app.setPath('userData', path.join(work, `profile-${route}`))
app.setName('Absor Synthetic Performance Lab')
ipcMain.handle('lab-config', e => {
  if (e.sender !== window.webContents) throw Error('Emisor inválido')
  return { ...config, route }
})
ipcMain.on('lab-result', (e, result) => {
  if (e.sender !== window.webContents) return
  const report = { ...result, route, electron: process.versions.electron, chromium: process.versions.chrome,
    syntheticOnly: true, physicalWindowsTested: false, physicalIpadTested: false }
  fs.writeFileSync(path.join(work, `report-${route}.json`), JSON.stringify(report, null, 2), { mode: 0o600 })
  console.log(JSON.stringify(report))
  app.exit(result.error ? 1 : 0)
})
app.whenReady().then(async () => {
  app.dock?.hide()
  window = new BrowserWindow({ show: false, width: 1280, height: 720, webPreferences: {
    preload: path.join(__dirname, 'preload.cjs'), sandbox: true, nodeIntegration: false,
    contextIsolation: true, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required'
  } })
  await window.loadFile(path.join(__dirname, 'out/index.html'))
})
setTimeout(() => app.exit(2), 200000).unref()

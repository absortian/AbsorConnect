// Señalización loopback exclusiva para vídeo artificial. No ejecuta órdenes del cliente.
const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const work = process.argv.find(a => a.startsWith('--work='))?.slice(7)
const route = process.argv.find(a => a.startsWith('--route='))?.slice(8) || 'direct'
if (!work || !path.isAbsolute(work) || !['direct', 'udp', 'tls'].includes(route)) process.exit(64)
const ice = route === 'direct' ? { iceServers: [] } : JSON.parse(fs.readFileSync(path.join(work, `turn-${route}.json`), 'utf8'))
let window, server, pending, ready = false, offered = false
app.setPath('userData', path.join(work, `mobile-profile-${route}`))
ipcMain.handle('quality-config', e => {
  if (e.sender !== window.webContents) throw Error('Emisor inválido')
  return ice
})
ipcMain.on('quality-ready', e => { if (e.sender === window.webContents) ready = true })
ipcMain.on('quality-answer', (e, value) => {
  if (e.sender !== window.webContents || !pending) return
  pending(value.error ? 500 : 200, value); pending = null
})
app.whenReady().then(async () => {
  app.dock?.hide()
  window = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, 'mobile-preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
  await window.loadFile(path.join(__dirname, 'out/mobile.html'))
  server = http.createServer(async (req, res) => {
    const reply = (status, value) => { if (!res.writableEnded) { res.writeHead(status, {'Content-Type': 'application/json'}); res.end(JSON.stringify(value)) } }
    if (req.method === 'GET' && req.url === '/config') return reply(ready ? 200 : 503, { ...ice, relayController: route !== 'direct' })
    if (req.method !== 'POST' || !['/offer/correct', '/result/correct'].includes(req.url)) return reply(400, { error: 'invalid_request' })
    try {
      let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 262144) return reply(413, {error:'too_large'}) }
      const value = JSON.parse(body)
      if (req.url === '/offer/correct') {
        if (!ready || offered || Object.keys(value).join() !== 'sdp' || typeof value.sdp !== 'string' || !value.sdp.startsWith('v=0')) return reply(400, {error:'invalid_offer'})
        offered = true; pending = reply
        window.webContents.send('quality-offer', value.sdp)
        setTimeout(() => { if (pending === reply) { pending = null; reply(504, {error:'timeout'}) } }, 25000).unref()
      } else {
        if (!offered) return reply(400, {error:'missing_offer'})
        fs.writeFileSync(path.join(work, `mobile-report-${route}.json`), JSON.stringify({route, syntheticOnly:true, physicalDeviceTested:false, ...value}, null, 2), {mode:0o600})
        reply(200, {ok:true})
        setTimeout(() => app.quit(), 1000)
      }
    } catch { reply(400, {error:'invalid_request'}) }
  })
  server.requestTimeout = 30000
  server.listen(8793, '127.0.0.1')
})
app.on('before-quit', () => server?.close())
setTimeout(() => app.exit(2), 600000).unref()

const { app, BrowserWindow } = require('electron')
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const output = process.argv.find(a => a.startsWith('--output='))?.slice(9)
if (!output) process.exit(64)
app.setPath('userData', path.join(output, 'profile'))
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
app.whenReady().then(async () => {
 const windows = []; let lastCommand = ''
 const consoleMessages = []
 const create = async (width = 1050, hash = '') => {
  const w = new BrowserWindow({ width, height: 760, show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } }); windows.push(w)
  w.webContents.on('console-message', (_event, _level, message) => { consoleMessages.push(String(message).slice(0,500)) })
  await w.loadFile(path.join(output, 'index.html'), { hash })
  return { w, js: code => { lastCommand = code; return w.webContents.executeJavaScript(code) }, shot: async name => { await w.webContents.executeJavaScript('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))'); const image = await w.webContents.capturePage(); fs.writeFileSync(path.join(output, name+'.png'), image.toPNG()) } }
 }
 try {
  const f = await create(), js = f.js
  await js('actionLab.connect()')
  await js('actionLab.open("restart")'); await js('actionLab.typeInModal()'); assert.equal((await js('actionLab.state()')).inputKeys, 0); await f.shot('confirm-es'); await js('actionLab.choose(false)')
  await js('actionLab.ready(() => !actionLab.state().dialogOpen)'); assert.equal((await js('actionLab.state()')).operations, 0)
  await js('actionLab.open("restart")'); await js('actionLab.withdraw()')
  await js('actionLab.ready(() => !actionLab.state().dialogOpen)'); assert.equal((await js('actionLab.state()')).operations, 0)
  await js('actionLab.restore(); actionLab.reply("rejected"); actionLab.open("restart")'); await js('actionLab.choose(true)')
  await js('actionLab.ready(() => actionLab.state().notice.includes("rechazó"))')
  const rejected = await js('actionLab.state()'); await js('actionLab.delay(2200)')
  assert.equal((await js('actionLab.state()')).presenceQueries, rejected.presenceQueries); assert.equal(rejected.waiting, false)
  await js('actionLab.reply("accepted"); actionLab.open("lock")'); await js('actionLab.choose(true)')
  await js('actionLab.ready(() => actionLab.state().notice.includes("aceptado"))')
  await js('actionLab.open("restart")'); await js('actionLab.choose(true)')
  await js('actionLab.ready(() => actionLab.state().waiting)'); assert.equal((await js('actionLab.state()')).cancelReachable, true); await f.shot('restart-wait')
  await js('actionLab.submit(); actionLab.delay(2200)'); assert.equal((await js('actionLab.state()')).requests, 1)
  await js('actionLab.cancelWait(); actionLab.submit(); actionLab.delay(150)')
  assert.equal((await js('actionLab.state()')).requests, 1)
  await js('actionLab.returned("2026-10-28T00:00:10Z"); actionLab.connect()')
  assert.equal((await js('actionLab.state()')).authentications, 2)
  await js('actionLab.open("restart")'); await js('actionLab.choose(true)')
  await js('actionLab.ready(() => actionLab.state().waiting)')
  await js('actionLab.returned("2026-10-28T00:00:20Z")')
  await js('actionLab.ready(() => !actionLab.state().waiting && actionLab.state().passwordVisible)')
  assert.equal((await js('actionLab.state()')).requests, 2)
  await f.shot('restart-ready')
  await js('actionLab.connect()'); assert.equal((await js('actionLab.state()')).authentications, 3)
  await js('actionLab.reply("silent"); actionLab.open("lock")'); await js('actionLab.choose(true)')
  await js('actionLab.ready(() => actionLab.state().notice.includes("No llegó"))')
  const result = await js('actionLab.state()')
  assert.equal(result.offlineOffers, 0); assert.equal(result.nonceCount, 3); assert.equal(result.actionDisabled, true); assert.equal(result.operations, 5); assert.equal(result.fatal, null); assert.equal(result.inputKeys, 0); assert.ok(result.releases > 0)
  const legacy = await create(); await legacy.js('actionLab.legacy(); actionLab.connect()'); const old = await legacy.js('actionLab.state()'); assert.equal(old.menuHidden, true); assert.equal(old.operations, 0)
  const en = await create(500, 'en'); await en.js('actionLab.connect()'); await en.js('actionLab.open("logout")'); assert.equal((await en.js('actionLab.state()')).dialogFits, true); assert.equal((await en.js('actionLab.state()')).dialogOpen, true); await en.shot('confirm-en-narrow'); await en.js('actionLab.choose(false)')
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ ok: true, productionViewerUsed: true, realLocalWebRtc: true, syntheticVideoOnly: true, operatingSystemActionsExecuted: false, rejected, result, legacy: old, newChallengesAfterRestart: true, physicalHostTested: false, protectedScreenCaptured: false }, null, 2), { mode: 0o600 })
  console.log(JSON.stringify({ok:true, actualViewer:true, actualWebRtc:true, operatingSystemActionsExecuted:false}))
 } catch (error) { console.error(error.message); const states = []; for (const w of windows) { states.push(await w.webContents.executeJavaScript('actionLab.state()').catch(() => null)); await w.webContents.capturePage().then(p => fs.writeFileSync(path.join(output, 'failure-screen.png'), p.toPNG())).catch(()=>{}) }; fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({error:error.message,lastCommand,states,consoleMessages}),{mode:0o600}); process.exitCode=1 }
 finally { for (const w of windows) { await w.webContents.executeJavaScript('actionLab.close()').catch(()=>{}); w.destroy() } app.quit() }
})
setTimeout(() => { process.exitCode=1; app.quit() },100000).unref()

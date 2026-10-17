// Prueba entre dos equipos (lan-check), papel de PC controlado. Se ejecuta con Electron (no como
// Node), porque además de la app de verdad abre una ventana de prueba:
//
//   node_modules/electron/dist/electron prototypes/remote-desktop/lan-check/out/pc.cjs \
//     --api=http://<ip del backend>:8020 --work=<carpeta temporal> --out=<fichero.json> [--minutes=30] \
//     [--app=<ejecutable de un paquete>] [--listen=127.0.0.1]
//
//   - Con --app, la app de verdad es ese ejecutable (un AppImage, linux-unpacked…) en vez de la de
//     desarrollo del repo: así se prueba el paquete (tarea 8.1).
//   - Con --listen, la sonda escucha solo en esa dirección. Con 127.0.0.1 (la VM de Windows, por un
//     túnel SSH) el cortafuegos de Windows no pregunta, y su diálogo no le quita el foco a la prueba.
//   - Prepara la app de verdad con la cuenta de prueba, la contraseña del PC y el control remoto
//     activado, y la arranca con su ventana y su puerto de DevTools.
//   - Tapa la pantalla principal con una ventana de prueba (un área de texto) que anota los clics,
//     la rueda y lo que se escribe.
//   - Abre una sonda HTTP en el puerto 8790 para el controlador: estado (ratón, pantallas, texto,
//     aviso, bandeja, bloqueo de suspensión, registro) y acciones en la app (desactivar, cambiar la
//     contraseña, confirmación local, mantener despierto, "Desconectar" del aviso).
//   - Termina cuando el controlador llama a /done, o a los --minutes minutos.
import { app, BrowserWindow, clipboard, desktopCapturer, screen, systemPreferences } from 'electron'
import { ChildProcess, execFile, spawn } from 'child_process'
import { createHash, randomBytes } from 'crypto'
import * as fs from 'fs'
import * as http from 'http'
import * as path from 'path'
import { Page, targets, waitTarget } from '../lib/cdp'
import { RemoteAccessStore } from '../../../src/main/remote/remoteAccessStore'
import { createPlaintextBox } from '../../../src/main/remote/secretBox'
import {
  API,
  args,
  createReport,
  describeError,
  lanAddress,
  login,
  PC_PASSWORD,
  PC_PREFIX,
  PROBE_PORT,
  sleep,
  systemName,
  TEST_EMAIL
} from './common'

const ROOT = path.resolve(__dirname, '..', '..', '..', '..')
const WORK = args.work
const DATA = WORK ? path.join(WORK, 'pc') : ''
const APP_DEBUG_PORT = 9336
const MINUTES = Number(args.minutes ?? 30)
const { report, note } = createReport('pc')

let child: ChildProcess | null = null
let target: BrowserWindow | null = null
let pcName = ''
const actions: { at: string; action: string; result: unknown }[] = []
/** Ficheros de la prueba: empiezan así, para poder borrarlos de Descargas/Absor Connect al terminar. */
const TEST_PREFIX = 'absor-prueba'
let downloadFile: { path: string; name: string; size: number; sha256: string } | null = null

const receiveDir = (): string => path.join(app.getPath('downloads'), 'Absor Connect')

/** Lo que ha llegado de la prueba a la carpeta de recepción (también los `.part` a medias). */
function received(): { name: string; size: number; sha256: string | null }[] {
  let names: string[] = []
  try {
    names = fs.readdirSync(receiveDir())
  } catch {
    return []
  }
  return names
    .filter((name) => name.startsWith(TEST_PREFIX) || name.startsWith(`.${TEST_PREFIX}`))
    .map((name) => {
      const file = path.join(receiveDir(), name)
      const size = fs.statSync(file).size
      const sha256 = size <= 64 * 1024 * 1024 ? createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null
      return { name, size, sha256 }
    })
}

/** Un fichero para descargar desde el controlador, en la carpeta de trabajo. */
function prepareDownload(): void {
  const dir = path.join(WORK, 'para-descargar')
  fs.mkdirSync(dir, { recursive: true })
  const data = randomBytes(2 * 1024 * 1024 + 123)
  const name = `${TEST_PREFIX}-descarga.bin`
  fs.writeFileSync(path.join(dir, name), data)
  downloadFile = { path: path.join(dir, name), name, size: data.length, sha256: createHash('sha256').update(data).digest('hex') }
}

function sh(command: string, argv: string[], timeout = 10_000): Promise<string> {
  return new Promise((resolve) =>
    execFile(command, argv, { timeout, encoding: 'utf8' }, (error, stdout, stderr) =>
      resolve(error ? `ERROR ${(stderr.trim() || error.message).slice(-300)}` : stdout.trim())
    )
  )
}

// --- La app de verdad ------------------------------------------------------------

async function prepareApp(): Promise<void> {
  const ip = lanAddress()
  pcName = `${PC_PREFIX} ${systemName()} @${ip}:${PROBE_PORT}`
  const token = await login(pcName)
  fs.rmSync(DATA, { recursive: true, force: true })
  fs.mkdirSync(DATA, { recursive: true })
  fs.writeFileSync(path.join(DATA, 'session.json'), JSON.stringify({ email: TEST_EMAIL, token, encrypted: false }))
  fs.writeFileSync(
    path.join(DATA, 'settings.json'),
    JSON.stringify({ theme: 'dark', language: 'es', keepInBackground: false, openAtLogin: false })
  )
  const store = new RemoteAccessStore(path.join(DATA, 'remote-access.json'), createPlaintextBox(), pcName)
  await store.bindToAccount(TEST_EMAIL)
  await store.setPassword(PC_PASSWORD)
  await store.setDeviceName(pcName)
  await store.setEnabled(true)
}

function launchApp(): void {
  const log = fs.openSync(path.join(DATA, 'app.log'), 'a')
  const env: NodeJS.ProcessEnv = { ...process.env, ABSOR_CONNECT_API_URL: API }
  delete env.ELECTRON_RUN_AS_NODE
  const [command, ...argv] = args.app ? [path.resolve(args.app)] : [process.execPath, ROOT]
  child = spawn(command, [...argv, `--user-data-dir=${DATA}`, `--remote-debugging-port=${APP_DEBUG_PORT}`], {
    env,
    stdio: ['ignore', log, log]
  })
  child.once('exit', (code, signal) => note(`la app de verdad ha terminado (${code ?? signal})`))
}

/** Evalúa en la ventana principal de la app de verdad: lo mismo que hace Ajustes. */
async function inApp<T>(expression: string): Promise<T> {
  const page = await Page.open(await waitTarget(APP_DEBUG_PORT, (t) => t.url.endsWith('index.html'), 15_000))
  try {
    return await page.eval<T>(expression)
  } finally {
    page.close()
  }
}

const NOTICE_TITLE = 'Absor Connect — aviso'
const CONFIRM_TITLE = 'Absor Connect — confirmación'

/** Ventana de la app de verdad por su título (el aviso de la sesión o la confirmación local). */
async function windowByTitle(title: string): Promise<Page | null> {
  const found = (await targets(APP_DEBUG_PORT)).find((t) => t.type === 'page' && t.title === title)
  return found ? Page.open(found) : null
}

async function noticeTarget(): Promise<{ title: string; text: string } | null> {
  const page = await windowByTitle(NOTICE_TITLE)
  if (!page) return null
  try {
    return await page.eval<{ title: string; text: string }>(`({ title: document.title, text: document.body.innerText })`)
  } finally {
    page.close()
  }
}

async function clickIn(title: string, button: string, waitMs = 0): Promise<boolean> {
  const deadline = Date.now() + waitMs
  let page = await windowByTitle(title)
  while (!page && Date.now() < deadline) {
    await sleep(500)
    page = await windowByTitle(title)
  }
  if (!page) return false
  try {
    await page.eval(`document.getElementById(${JSON.stringify(button)}).click()`).catch(() => undefined)
    return true
  } finally {
    page.close()
  }
}

// --- Lo que el sistema dice de la app ------------------------------------------------

/**
 * Bloqueos de suspensión de la app de verdad (powerSaveBlocker 'prevent-app-suspension'), con su
 * identificador: el controlador compara antes, durante y después, porque Chromium pide otros
 * mientras reproduce vídeo y en una prueba en un solo equipo las dos apps son el mismo ejecutable.
 */
async function keepAwake(): Promise<{ ids: string[]; detail: string }> {
  if (!child?.pid) return { ids: [], detail: 'sin app' }
  if (process.platform === 'darwin') {
    const out = await sh('pmset', ['-g', 'assertions'])
    // 'prevent-app-suspension' es una aserción NoIdleSleepAssertion (o PreventUserIdleSystemSleep)
    const own = out.split('\n').filter((l) => l.includes(`pid ${child!.pid}(`))
    const lines = own.filter((l) => /NoIdleSleep|PreventUserIdleSystemSleep|PreventSystemSleep/.test(l))
    return { ids: lines.map((l) => l.match(/\[(0x[0-9a-f]+)\]/i)?.[1] ?? l.trim()), detail: own.map((l) => l.trim()).join(' | ') }
  }
  if (process.platform === 'linux') {
    // Chromium lo pide al gestor de sesión (GNOME, Cinnamon…), con el ejecutable como AppId
    const list = await sh('gdbus', ['call', '--session', '--dest', 'org.gnome.SessionManager', '--object-path', '/org/gnome/SessionManager', '--method', 'org.gnome.SessionManager.GetInhibitors'])
    if (list.startsWith('ERROR')) return { ids: [], detail: list }
    const ids: string[] = []
    for (const p of list.match(/'\/[^']+'/g)?.map((x) => x.slice(1, -1)) ?? []) {
      const q = (method: string): Promise<string> =>
        sh('gdbus', ['call', '--session', '--dest', 'org.gnome.SessionManager', '--object-path', p, '--method', `org.gnome.SessionManager.Inhibitor.${method}`])
      // El de powerSaveBlocker lleva el motivo "Electron"; Chromium pide otros propios (p. ej. al
      // reproducir sonido), y en una prueba en un solo equipo todas las apps son el mismo ejecutable
      if (!(await q('GetAppId')).includes(process.execPath)) continue
      if (!(await q('GetReason')).includes("'Electron'")) continue
      ids.push(`${p} flags=${(await q('GetFlags')).match(/uint32 (\d+)/)?.[1] ?? '?'}`)
    }
    return { ids, detail: `${ids.length} del ejecutable de Electron` }
  }
  // Windows: `powercfg /requests` necesita un administrador
  return { ids: [], detail: 'sistema sin comprobación' }
}

/** Entradas del menú de la bandeja de la app de verdad. */
async function trayItems(): Promise<string[] | string> {
  if (!child?.pid) return 'sin app'
  if (process.platform === 'linux') {
    const raw = await sh('gdbus', ['call', '--session', '--dest', 'org.kde.StatusNotifierWatcher', '--object-path', '/StatusNotifierWatcher', '--method', 'org.freedesktop.DBus.Properties.Get', 'org.kde.StatusNotifierWatcher', 'RegisteredStatusNotifierItems'])
    const items = raw.match(/'[^']+'/g)?.map((s) => s.slice(1, -1)) ?? []
    for (const item of items) {
      const slash = item.indexOf('/')
      const service = slash > 0 ? item.slice(0, slash) : item
      const objectPath = slash > 0 ? item.slice(slash) : '/StatusNotifierItem'
      const pid = await sh('gdbus', ['call', '--session', '--dest', 'org.freedesktop.DBus', '--object-path', '/org/freedesktop/DBus', '--method', 'org.freedesktop.DBus.GetConnectionUnixProcessID', service])
      if (!pid.includes(String(child.pid))) continue
      const menu = await sh('gdbus', ['call', '--session', '--dest', service, '--object-path', objectPath, '--method', 'org.freedesktop.DBus.Properties.Get', 'org.kde.StatusNotifierItem', 'Menu'])
      const menuPath = menu.match(/objectpath '([^']+)'/)?.[1]
      if (!menuPath) return `sin menú: ${menu}`
      const layout = await sh('gdbus', ['call', '--session', '--dest', service, '--object-path', menuPath, '--method', 'com.canonical.dbusmenu.GetLayout', '--', '0', '-1', "['label']"])
      if (layout.startsWith('ERROR')) return layout
      return [...layout.matchAll(/'label': <'([^']*)'>/g)].map((m) => m[1].replace(/_/g, ''))
    }
    const owners: string[] = []
    for (const item of items) {
      const service = item.includes('/') ? item.slice(0, item.indexOf('/')) : item
      owners.push(`${item} (${(await sh('gdbus', ['call', '--session', '--dest', 'org.freedesktop.DBus', '--object-path', '/org/freedesktop/DBus', '--method', 'org.freedesktop.DBus.GetConnectionUnixProcessID', service])).replace(/\D+/g, ' ').trim()})`)
    }
    return `la app (pid ${child.pid}) no tiene icono en la bandeja; registrados: ${owners.join(', ') || 'ninguno'}`
  }
  if (process.platform === 'darwin') {
    // Abrir el menú con System Events se queda esperando: se lanza sin esperar y se reinicia
    // System Events (como en background-check)
    const it = `(first process whose unix id is ${child.pid})`
    const script = [
      'ignoring application responses',
      `  tell application "System Events" to tell ${it} to click menu bar item 1 of menu bar 2`,
      'end ignoring',
      'do shell script "killall System\\\\ Events"',
      'delay 0.6',
      `tell application "System Events" to tell ${it}`,
      '  tell menu 1 of menu bar item 1 of menu bar 2',
      '    set itemNames to name of every menu item',
      '    key code 53',
      "    set AppleScript's text item delimiters to linefeed",
      '    return itemNames as text',
      '  end tell',
      'end tell'
    ].join('\n')
    const out = await sh('osascript', ['-e', script], 20_000)
    return out.startsWith('ERROR') ? out : out.split('\n').filter((s) => s && s !== 'missing value')
  }
  return 'sistema sin comprobación'
}

// --- Ventana de prueba ---------------------------------------------------------------

const TARGET_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Absor Connect — prueba entre dos equipos</title>
<style>
html,body{margin:0;height:100%;font:16px system-ui,sans-serif;background:#10141c;color:#e6e9ef}
body{display:flex;flex-direction:column;gap:12px;padding:24px;box-sizing:border-box}
h1{margin:0;font-size:22px} #say{font-size:20px;color:#facc15;min-height:28px}
textarea{flex:1;font:28px system-ui,sans-serif;background:#1d2433;color:#fff;border:2px solid #5b6cf0;border-radius:8px;padding:12px}
</style></head><body>
<h1>Absor Connect — prueba de control remoto entre dos equipos</h1>
<div>Otro equipo está controlando este. No toques el ratón ni el teclado hasta que termine.</div>
<div id="say"></div>
<textarea id="text" spellcheck="false"></textarea>
<script>
window.events = []
const add = (e) => { window.events.push(e); if (window.events.length > 500) window.events.shift() }
document.addEventListener('mousedown', (e) => add({ type: 'mousedown', x: e.screenX, y: e.screenY, button: e.button }), true)
document.addEventListener('wheel', (e) => add({ type: 'wheel', dx: e.deltaX, dy: e.deltaY }), true)
document.addEventListener('keydown', (e) => add({ type: 'keydown', code: e.code, key: e.key }), true)
window.snapshot = () => ({ events: window.events, text: document.getElementById('text').value, focused: document.hasFocus() })
window.reset = () => { window.events = []; document.getElementById('text').value = '' }
</script></body></html>`

function openTarget(): void {
  // Una ventana normal, abierta la última y con el foco. Siempre encima y tapando el área de
  // trabajo, Cinnamon 6.6 (muffin) se cayó al activar otra ventana (window_may_be_covered_by_above)
  const { workArea } = screen.getPrimaryDisplay()
  target = new BrowserWindow({
    ...workArea,
    frame: false,
    resizable: false,
    backgroundColor: '#10141c',
    webPreferences: { sandbox: true, contextIsolation: true }
  })
  void target.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(TARGET_HTML)}`)
}

async function inTarget<T>(expression: string): Promise<T> {
  return (await target!.webContents.executeJavaScript(expression)) as T
}

// --- Sonda HTTP para el controlador -------------------------------------------------------

async function state(): Promise<unknown> {
  const displays = screen.getAllDisplays().map((d) => ({
    id: String(d.id),
    bounds: d.bounds,
    scaleFactor: d.scaleFactor,
    primary: d.id === screen.getPrimaryDisplay().id
  }))
  const settings = await inApp<any>(`window.api.remoteSettings()`).catch((e) => ({ error: String(e) }))
  return {
    name: pcName,
    platform: process.platform,
    system: report.system,
    pointer: screen.getCursorScreenPoint(),
    displays,
    target: { bounds: target?.getBounds(), ...(await inTarget<object>('window.snapshot()').catch(() => ({}))) },
    notice: await noticeTarget().catch(() => null),
    clipboard: { text: clipboard.readText(), image: clipboard.readImage().isEmpty() ? null : clipboard.readImage().getSize() },
    received: received(),
    download: downloadFile,
    confirm: !!(await targets(APP_DEBUG_PORT)).find((t) => t.title === CONFIRM_TITLE),
    // Linux: la fuente virtual de sonido de la app (D8) existe solo durante la sesión
    linuxAudioSource:
      process.platform === 'linux' ? (await sh('pactl', ['list', 'short', 'sources'])).includes('absor_connect_audio') : null,
    keepAwake: await keepAwake(),
    settings: settings?.state ? { enabled: settings.state.enabled, active: settings.state.active, confirmLocal: settings.state.confirmLocal, preventSleep: settings.state.preventSleep, features: settings.state.features, support: settings.state.support } : settings,
    log: settings?.state?.log ?? null
  }
}

async function appAction(action: string, body: any): Promise<unknown> {
  switch (action) {
    case 'disable':
      return inApp(`window.api.setRemoteEnabled(false).then((r) => r.ok)`)
    case 'enable':
      return inApp(`window.api.setRemoteEnabled(true).then((r) => r.ok)`)
    case 'password':
      return inApp(`window.api.setRemotePassword(${JSON.stringify(String(body.password))}).then((r) => r.ok)`)
    case 'confirm-on':
    case 'confirm-off':
      return inApp(`window.api.updateRemoteSettings({ confirmLocal: ${action === 'confirm-on'} }).then((r) => r.ok)`)
    case 'sleep-on':
    case 'sleep-off':
      return inApp(`window.api.updateRemoteSettings({ preventSleep: ${action === 'sleep-on'} }).then((r) => r.ok)`)
    case 'clipboard-set':
      clipboard.writeText(String(body.text ?? ''))
      return true
    case 'files-off':
    case 'files-on':
      return inApp(`window.api.updateRemoteSettings({ features: { files: ${action === 'files-on'} } }).then((r) => r.ok)`)
    case 'cleanup-received':
      for (const file of received()) fs.rmSync(path.join(receiveDir(), file.name), { force: true })
      return true
    case 'tone-on':
      // Un pitido suave por la salida por defecto, para medir en el controlador que llega el sonido
      return inTarget(`(async () => {
        window.tone = new AudioContext()
        const oscillator = window.tone.createOscillator(), gain = window.tone.createGain()
        oscillator.frequency.value = 440; gain.gain.value = 0.15
        oscillator.connect(gain).connect(window.tone.destination); oscillator.start()
        await window.tone.resume(); return window.tone.state
      })()`)
    case 'tone-off':
      return inTarget(`(async () => { await window.tone?.close(); window.tone = null; return true })()`)
    case 'notice-disconnect':
      return clickIn(NOTICE_TITLE, 'disconnect')
    case 'confirm-allow':
      // Espera a que salga la pregunta (tras la contraseña correcta) y pulsa «Permitir»
      return clickIn(CONFIRM_TITLE, 'allow', 30_000)
    default:
      throw new Error(`acción desconocida: ${action}`)
  }
}

let finish: () => void = () => undefined
const finished = new Promise<void>((resolve) => (finish = resolve))

/**
 * Proceso de la ventana que está delante, en Windows (null en el resto). Tras la tecla Windows la
 * ventana de prueba no recibe el keydown: se lo queda el sistema, que abre Inicio
 * (StartMenuExperienceHost, o SearchHost en algunas versiones).
 */
async function foreground(): Promise<string | null> {
  if (process.platform !== 'win32') return null
  const script =
    'Add-Type -MemberDefinition \'[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow(); ' +
    '[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, out uint p);\' -Name W -Namespace U; ' +
    '$p = 0; [void][U.W]::GetWindowThreadProcessId([U.W]::GetForegroundWindow(), [ref]$p); (Get-Process -Id $p).ProcessName'
  return (await sh('powershell', ['-NoProfile', '-NonInteractive', '-Command', script])).trim() || null
}

/** Arranca la sonda; si el puerto está ocupado (otra prueba sin terminar), falla en vez de seguir. */
function startProbe(): Promise<http.Server> {
  const server = http.createServer((request, response) => {
    let raw = ''
    request.on('data', (chunk) => (raw += chunk))
    request.on('end', () => {
      void (async () => {
        const body = raw ? JSON.parse(raw) : {}
        const url = request.url ?? '/'
        if (request.method === 'GET' && url === '/state') return state()
        if (request.method === 'GET' && url === '/tray') return trayItems()
        if (request.method === 'GET' && url === '/foreground') return foreground()
        if (request.method === 'POST' && url === '/reset') return inTarget('window.reset(), true')
        if (request.method === 'POST' && url === '/say') {
          return inTarget(`document.getElementById('say').textContent = ${JSON.stringify(String(body.text ?? ''))}, true`)
        }
        if (request.method === 'POST' && url === '/app') {
          const result = await appAction(String(body.action), body)
          actions.push({ at: new Date().toISOString(), action: String(body.action), result })
          return result
        }
        if (request.method === 'POST' && url === '/done') {
          report.notes.push(...(Array.isArray(body.notes) ? body.notes.map(String) : []))
          setTimeout(finish, 200)
          return true
        }
        throw Object.assign(new Error('no existe'), { status: 404 })
      })()
        .then((result) => {
          response.writeHead(200, { 'Content-Type': 'application/json' })
          response.end(JSON.stringify(result ?? null))
        })
        .catch((error) => {
          response.writeHead(error?.status ?? 500, { 'Content-Type': 'application/json' })
          response.end(JSON.stringify({ error: String(error?.message ?? error) }))
        })
    })
  })
  return new Promise((resolve, reject) => {
    server.once('error', (error) => reject(new Error(`La sonda no puede usar el puerto ${PROBE_PORT}: ${error.message}. ¿Queda otra prueba abierta?`)))
    server.listen(PROBE_PORT, args.listen ?? '0.0.0.0', () => resolve(server))
  })
}

/**
 * macOS da los permisos a la app "responsable" del proceso: la de terminal desde la que se lanza la
 * prueba (Terminal, iTerm, VS Code…). Se busca subiendo por los procesos padre hasta launchd: es la
 * app (.app) más externa de la cadena.
 */
async function macPermissionsDiagnosis(): Promise<{ app: string; chain: string[]; thisProcess: object }> {
  const chain: string[] = []
  let pid = process.pid
  for (let i = 0; i < 30 && pid > 1; i++) {
    const line = await sh('ps', ['-o', 'ppid=,comm=', '-p', String(pid)])
    const match = line.trim().match(/^(\d+)\s+(.*)$/)
    if (!match) break
    chain.push(`${pid} ${match[2]}`)
    pid = Number(match[1])
  }
  const apps = chain.map((entry) => entry.match(/\/([^/]+)\.app\//)?.[1]).filter((name): name is string => !!name)
  return {
    app: apps.at(-1) ?? 'la app de terminal desde la que la lanzas',
    chain,
    thisProcess: {
      screen: systemPreferences.getMediaAccessStatus('screen'),
      accessibility: systemPreferences.isTrustedAccessibilityClient(false)
    }
  }
}

/**
 * Sin Grabación de pantalla, la pide a macOS (como el botón de Ajustes: aparece su aviso y la app
 * responsable entra en la lista del panel) y espera a que se conceda, para no tener que relanzar.
 */
async function requestMacScreen(): Promise<void> {
  if (process.platform !== 'darwin' || systemPreferences.getMediaAccessStatus('screen') === 'granted') return
  const { app: responsible } = await macPermissionsDiagnosis()
  console.log(`\n==> «${responsible}» no tiene permiso de Grabación de pantalla. Se lo pido a macOS:`)
  console.log(`    si sale su aviso, pulsa «Abrir Ajustes del Sistema» y activa «${responsible}» en`)
  console.log('    Grabación de pantalla y audio del sistema. Si no sale, abre ese panel y actívalo a mano.')
  console.log(`    Si macOS pide salir y volver a abrir «${responsible}», hazlo y lanza la prueba otra vez.\n`)
  void desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } }).catch(() => undefined)
  const deadline = Date.now() + 3 * 60_000
  while (Date.now() < deadline) {
    await sleep(2000)
    if (systemPreferences.getMediaAccessStatus('screen') === 'granted') {
      note('el permiso de Grabación de pantalla se ha concedido durante la prueba')
      return
    }
  }
  note('tras pedirlo, el permiso de Grabación de pantalla sigue sin conceder')
}

async function run(): Promise<void> {
  if (!WORK) throw new Error('Falta --work')
  await requestMacScreen()
  await prepareApp()
  prepareDownload()
  launchApp()
  await waitTarget(APP_DEBUG_PORT, (t) => t.url.endsWith('index.html'), 60_000)
  // Si este equipo no se puede controlar (permisos de macOS, Wayland), se dice ya: el otro equipo
  // esperaría hasta cansarse a que apareciera disponible
  const support = await inApp<any>(`window.api.remoteSettings().then((r) => r.state?.support)`)
  if (process.platform === 'darwin') Object.assign(report, { permissions: { realApp: support, ...(await macPermissionsDiagnosis()) } })
  if (support?.state !== 'available') {
    const missing = (support?.missing ?? []).map((p: string) => (p === 'screen' ? 'Grabación de pantalla' : 'Accesibilidad'))
    const responsible = process.platform === 'darwin' ? (report as any).permissions.app : 'Terminal'
    throw new Error(
      missing.length > 0
        ? `Faltan permisos de macOS: ${missing.join(' y ')}. macOS se los pide a «${responsible}», la app desde la que se lanza la prueba: concédeselos en Ajustes del Sistema > Privacidad y seguridad, cierra «${responsible}» del todo (Cmd+Q) y vuelve a lanzar la prueba. Si ya aparece activado y aun así falla, el permiso está caducado: bórralo con «tccutil reset ScreenCapture» y el identificador de la app (com.apple.Terminal para Terminal) y vuelve a concederlo.`
        : `Este equipo no se puede controlar: ${JSON.stringify(support)}`
    )
  }
  openTarget()
  await startProbe()
  console.log(`\n==> Listo: este equipo aparece en la cuenta como «${pcName}».`)
  console.log(`==> Esperando al controlador (hasta ${MINUTES} min). No toques el ratón ni el teclado.\n`)
  const timedOut = await Promise.race([finished.then(() => false), sleep(MINUTES * 60_000).then(() => true)])
  if (timedOut) note(`nadie ha terminado la prueba en ${MINUTES} min`)
  const last = (await state().catch((e) => ({ error: String(e) }))) as any
  for (const file of received()) fs.rmSync(path.join(receiveDir(), file.name), { force: true })
  Object.assign(report, { name: pcName, actions, finalState: { settings: last.settings, log: last.log, displays: last.displays } })
}

app.whenReady().then(() =>
  run()
    .catch((error) => {
      report.error = describeError(error)
      console.error(error)
    })
    .finally(async () => {
      target?.destroy()
      if (child && child.exitCode === null) {
        const exited = new Promise((resolve) => child!.once('exit', resolve))
        child.kill('SIGTERM')
        await Promise.race([exited, sleep(10_000)])
        if (child.exitCode === null) child.kill('SIGKILL')
      }
      if (args.out) fs.writeFileSync(args.out, JSON.stringify(report, null, 2))
      app.exit(report.error ? 1 : 0)
    })
)
app.on('window-all-closed', () => undefined)

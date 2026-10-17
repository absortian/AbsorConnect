// Prueba de salir de la cuenta y de actualizar durante una sesión (tareas 4.10 y 4.2), con dos
// instancias de la app de verdad en un Linux X11 y el backend de desarrollo. A hace de PC controlado
// y B de controlador; las dos se manejan por DevTools (--remote-debugging-port), como una persona:
//
//   1. A cierra sesión en Ajustes mientras B lo controla: la sesión termina, A deja de aparecer en
//      la cuenta (y no vuelve solo) y, al volver a entrar, vuelve a estar disponible.
//   2. B cierra sesión con el visor abierto: el visor se cierra y A queda libre.
//   3. La sesión de A caduca (se revoca su token) con A en la bandeja y B conectado: la sesión
//      termina, llega la notificación y A deja de estar en línea.
//   4. Solo con --appimage: A es un AppImage 0.0.1 que encuentra la 9.9.9 en un servidor local.
//      Con B conectado se descarga y se pulsa "Reiniciar y actualizar": no se reinicia, lo explica
//      y la sesión sigue. Sin sesión, el mismo botón instala la versión nueva y cierra la app.
//
// Se ejecuta con Electron como Node:
//
//   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron prototypes/remote-desktop/exit-check/out/main.cjs \
//     --api=http://127.0.0.1:8020 --work=<carpeta temporal> --out=<fichero.json> [--appimage=<AbsorCheck 0.0.1>]
//
// No mueve el ratón ni hace clics en el PC. Las notificaciones se leen con dbus-monitor y la bandeja
// por D-Bus (StatusNotifierItem). Si el escritorio no ofrece servicio de notificaciones o bandeja
// (p. ej. con la shell de Cinnamon caída), `desktop-stub.py` los pone mientras dura la prueba.
import { ChildProcess, execFile, spawn } from 'child_process'
import { createHash } from 'crypto'
import * as fs from 'fs'
import * as http from 'http'
import * as path from 'path'
import { Page, targets, waitTarget } from '../lib/cdp'
import { RemoteAccessStore } from '../../../src/main/remote/remoteAccessStore'
import { createPlaintextBox } from '../../../src/main/remote/secretBox'

const args = Object.fromEntries(
  process.argv
    .filter((a) => a.startsWith('--') && a.includes('='))
    .map((a) => [a.slice(2, a.indexOf('=')), a.slice(a.indexOf('=') + 1)])
)
const API = (args.api ?? 'http://127.0.0.1:8020').replace(/\/+$/, '')
const ROOT = path.resolve(__dirname, '..', '..', '..', '..')
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron')
const WORK = args.work
const PC_DATA = path.join(WORK ?? '', 'pc')
const CONTROLLER_DATA = path.join(WORK ?? '', 'controlador')
const CONTROLLER_PORT = 9333
const PC_PORT = 9334
/** Servidor de actualizaciones local (la URL con la que se empaqueta AbsorCheck). */
const UPDATE_PORT = 8799
const TEST_EMAIL = 'prueba-control-local@example.test'
const ACCOUNT_PASSWORD = 'contraseña-de-prueba-larga'
const PC_PASSWORD = 'contraseña-del-pc-prueba'
const CONTROLLER_NAME = 'Controlador de prueba'
const PC_NAME = `PC de prueba ${new Date().toTimeString().slice(0, 8)}`
const PC_UPDATE_NAME = `${PC_NAME} (AppImage)`
const SIGNED_OUT_TEXT = 'El PC ha cerrado la sesión de la cuenta.'

interface Check {
  name: string
  ok: boolean
  detail: unknown
}
const report: { desktop: string; checks: Check[]; error: string | null } = {
  desktop: '',
  checks: [],
  error: null
}
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function check(name: string, ok: boolean, detail: unknown): void {
  report.checks.push({ name, ok, detail })
  console.log(`${ok ? 'OK   ' : 'FALLO'} ${name} ${JSON.stringify(detail).slice(0, 400)}`)
}

// --- API -------------------------------------------------------------------------

async function api(
  method: string,
  pathname: string,
  token?: string,
  body?: unknown
): Promise<{ status: number; data: any }> {
  const response = await fetch(`${API}${pathname}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  })
  const text = await response.text()
  return { status: response.status, data: text ? JSON.parse(text) : null }
}

async function login(deviceName: string): Promise<string> {
  const body = { email: TEST_EMAIL, password: ACCOUNT_PASSWORD, deviceName }
  let result = await api('POST', '/api/auth/login', undefined, body)
  if (result.status !== 200) result = await api('POST', '/api/auth/register', undefined, body)
  if (typeof result.data?.token !== 'string') {
    throw new Error(`Sin sesión de prueba: ${JSON.stringify(result)}`)
  }
  return result.data.token
}

// Una tercera sesión de la cuenta, que no se cierra nunca, para mirar la lista de equipos
let observerToken = ''

interface DeviceEntry {
  name: string
  online: boolean
  remote: { state: string }
}

async function device(name: string): Promise<DeviceEntry | undefined> {
  const { data } = await api('GET', '/api/devices', observerToken)
  return (data?.devices as DeviceEntry[] | undefined)?.find((d) => d.name === name)
}

async function waitDevice(
  name: string,
  ok: (d: DeviceEntry | undefined) => boolean,
  ms = 20_000
): Promise<DeviceEntry | undefined> {
  const deadline = Date.now() + ms
  for (;;) {
    const found = await device(name)
    if (ok(found) || Date.now() > deadline) return found
    await sleep(1000)
  }
}

// --- Las apps --------------------------------------------------------------------

/** Sesión de la cuenta (sin cifrar, prefijo que la caja segura también lee) y ajustes locales. */
function writeSession(dir: string, token: string): void {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'session.json'),
    JSON.stringify({ email: TEST_EMAIL, token, encrypted: false })
  )
  fs.writeFileSync(
    path.join(dir, 'settings.json'),
    JSON.stringify({ theme: 'dark', language: 'es', keepInBackground: false, openAtLogin: false })
  )
}

/** El PC: con contraseña y el control remoto activado. */
async function preparePc(dir: string, name: string, token: string): Promise<void> {
  writeSession(dir, token)
  const store = new RemoteAccessStore(
    path.join(dir, 'remote-access.json'),
    createPlaintextBox(),
    name
  )
  await store.bindToAccount(TEST_EMAIL)
  await store.setPassword(PC_PASSWORD)
  await store.setDeviceName(name)
  await store.setEnabled(true)
}

const children: ChildProcess[] = []

function launch(
  dir: string,
  extra: string[],
  executable = ELECTRON,
  env: Record<string, string> = {}
): ChildProcess {
  const log = fs.openSync(path.join(dir, 'app.log'), 'a')
  const argv = executable === ELECTRON ? [ROOT] : []
  const child = spawn(executable, [...argv, `--user-data-dir=${dir}`, ...extra], {
    env: { ...process.env, ABSOR_CONNECT_API_URL: API, ELECTRON_RUN_AS_NODE: '', ...env },
    stdio: ['ignore', log, log]
  })
  children.push(child)
  return child
}

async function stop(child: ChildProcess | null, ms = 15_000): Promise<boolean> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return true
  child.kill('SIGTERM')
  return exited(child, ms)
}

function exited(child: ChildProcess, ms: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true)
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve(true)
    })
  })
}

const alive = (child: ChildProcess | null): boolean =>
  !!child && child.exitCode === null && child.signalCode === null

/** La ventana principal de una instancia (la de index.html). */
async function mainPage(port: number): Promise<Page> {
  const page = await Page.open(await waitTarget(port, (t) => t.url.endsWith('index.html'), 40_000))
  await page.waitFor<boolean>(
    `!!document.querySelector('button[title="Ajustes"]') || !!document.getElementById('auth-email')`,
    (v) => v === true,
    30_000
  )
  return page
}

const clickText = (page: Page, text: string): Promise<boolean> =>
  page.eval<boolean>(`(() => {
    const button = [...document.querySelectorAll('button')].find((b) => b.innerText.trim().includes(${JSON.stringify(text)}))
    if (!button) return false
    button.click()
    return true
  })()`)

const pageText = (page: Page): Promise<string> =>
  page.eval<string>(`document.body.innerText`).catch(() => '')

/** Escribe como una persona en un campo de React (el valor puesto por JS no dispara onChange). */
async function typeInto(page: Page, selector: string, text: string): Promise<void> {
  await page.eval(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.focus(); e.select() })()`)
  await page.send('Input.insertText', { text })
}

/** Ajustes → Cerrar sesión. */
async function signOutFromSettings(page: Page): Promise<boolean> {
  await page.eval(`document.querySelector('.settings-overlay')?.click()`)
  await page.eval(`document.querySelector('button[title="Ajustes"]').click()`)
  await page.waitFor<boolean>(
    `[...document.querySelectorAll('button')].some((b) => b.innerText.includes('Cerrar sesión'))`,
    (v) => v === true,
    10_000
  )
  return clickText(page, 'Cerrar sesión')
}

/** Equipos → Conectar → contraseña. Devuelve la ventana de visor ya con imagen. */
async function connect(ui: Page, pcName: string): Promise<{ viewer: Page; connected: boolean }> {
  await ui.eval(`document.querySelector('.settings-overlay')?.click()`)
  await ui.eval(`document.querySelector('button[title="Equipos"]').click()`)
  await ui.waitFor<string>(
    `[...document.querySelectorAll('.settings-row')].find((r) => r.innerText.includes(${JSON.stringify(pcName)}))?.innerText ?? ''`,
    (text) => text.includes('Disponible'),
    40_000
  )
  await ui.eval(
    `[...document.querySelectorAll('.settings-row')].find((r) => r.innerText.includes(${JSON.stringify(pcName)})).querySelector('button').click()`
  )
  const viewer = await Page.open(
    await waitTarget(CONTROLLER_PORT, (t) => t.url.includes('viewer.html'))
  )
  await viewer.waitFor<boolean>(`!!document.getElementById('password')`, (v) => v === true, 15_000)
  await viewer.eval(
    `(() => { document.getElementById('password').value = ${JSON.stringify(PC_PASSWORD)}; document.getElementById('login').requestSubmit() })()`
  )
  const connected = await viewer.waitFor<boolean>(
    `document.getElementById('overlay').hidden && document.getElementById('video').videoWidth > 0`,
    (v) => v === true,
    30_000
  )
  return { viewer, connected: connected === true }
}

const viewerMessage = (viewer: Page, text: string, ms = 20_000): Promise<string> =>
  viewer.waitFor<string>(
    `document.getElementById('overlay').hidden ? '' : document.getElementById('message').textContent`,
    (t) => t === text,
    ms
  )

const viewerOpen = async (): Promise<boolean> =>
  (await targets(CONTROLLER_PORT)).some((t) => t.url.includes('viewer.html'))

/** Fotogramas recibidos por el visor hasta ahora. */
const framesOf = (viewer: Page): Promise<number> =>
  viewer.eval<number>(`document.getElementById('video').getVideoPlaybackQuality().totalVideoFrames`)

// --- Sistema: bandeja y notificaciones ---------------------------------------------

function sh(command: string, argv: string[], timeout = 10_000): Promise<string> {
  return new Promise((resolve) =>
    execFile(command, argv, { timeout, encoding: 'utf8' }, (error, stdout, stderr) =>
      resolve(error ? `ERROR ${(stderr.trim() || error.message).slice(-300)}` : stdout.trim())
    )
  )
}

/** El proceso o alguno de sus antecesores es `root` (un AppImage lanza la app como hija). */
function descendsFrom(pid: number, root: number): boolean {
  for (let current = pid, depth = 0; current > 1 && depth < 10; depth++) {
    if (current === root) return true
    try {
      const status = fs.readFileSync(`/proc/${current}/status`, 'utf8')
      current = Number(status.match(/^PPid:\s+(\d+)/m)?.[1] ?? 0)
    } catch {
      return false
    }
  }
  return false
}

/** Entradas del menú de la bandeja de una instancia. */
async function trayItems(child: ChildProcess | null): Promise<string[] | string> {
  if (!child?.pid) return 'sin app'
  const raw = await sh('gdbus', ['call', '--session', '--dest', 'org.kde.StatusNotifierWatcher', '--object-path', '/StatusNotifierWatcher', '--method', 'org.freedesktop.DBus.Properties.Get', 'org.kde.StatusNotifierWatcher', 'RegisteredStatusNotifierItems'])
  for (const item of raw.match(/'[^']+'/g)?.map((s) => s.slice(1, -1)) ?? []) {
    const slash = item.indexOf('/')
    const service = slash > 0 ? item.slice(0, slash) : item
    const objectPath = slash > 0 ? item.slice(slash) : '/StatusNotifierItem'
    const pid = await sh('gdbus', ['call', '--session', '--dest', 'org.freedesktop.DBus', '--object-path', '/org/freedesktop/DBus', '--method', 'org.freedesktop.DBus.GetConnectionUnixProcessID', service])
    if (!descendsFrom(Number(pid.match(/uint32 (\d+)/)?.[1] ?? 0), child.pid)) continue
    const menu = await sh('gdbus', ['call', '--session', '--dest', service, '--object-path', objectPath, '--method', 'org.freedesktop.DBus.Properties.Get', 'org.kde.StatusNotifierItem', 'Menu'])
    const menuPath = menu.match(/objectpath '([^']+)'/)?.[1]
    if (!menuPath) return `sin menú: ${menu}`
    const layout = await sh('gdbus', ['call', '--session', '--dest', service, '--object-path', menuPath, '--method', 'com.canonical.dbusmenu.GetLayout', '--', '0', '-1', "['label']"])
    if (layout.startsWith('ERROR')) return layout
    return [...layout.matchAll(/'label': <'([^']*)'>/g)].map((m) => m[1].replace(/_/g, ''))
  }
  return 'sin icono en la bandeja'
}

async function waitTray(
  child: ChildProcess | null,
  label: string,
  ms = 15_000
): Promise<string[] | string> {
  const deadline = Date.now() + ms
  for (;;) {
    const items = await trayItems(child)
    if ((Array.isArray(items) && items.includes(label)) || Date.now() > deadline) return items
    await sleep(1000)
  }
}

/**
 * Las notificaciones que se muestran mientras dura la prueba (dbus-monitor). Antes, si faltan, se
 * ponen el servicio de notificaciones y la bandeja (`desktop-stub.py`), que deben existir antes de
 * arrancar las apps: Chromium solo busca la bandeja al crear el icono.
 */
async function watchNotifications(): Promise<{ seen: () => string; offered: string; stop: () => void }> {
  let output = ''
  const monitor = spawn('dbus-monitor', ['--session', "interface='org.freedesktop.Notifications',member='Notify'"])
  monitor.stdout.on('data', (chunk) => (output += String(chunk)))
  const stub = spawn('python3', [path.join(__dirname, '..', 'desktop-stub.py')])
  stub.stdout.on('data', (chunk) => (output += String(chunk)))
  const deadline = Date.now() + 10_000
  while (!output.includes('"offered"') && Date.now() < deadline) await sleep(200)
  const offered = output.match(/\{"offered": \[[^\]]*\]\}/)?.[0] ?? 'sin respuesta de desktop-stub.py'
  return {
    seen: () => output,
    offered,
    stop: () => {
      monitor.kill('SIGTERM')
      stub.kill('SIGTERM')
    }
  }
}

async function waitNotification(
  notifications: { seen: () => string },
  text: string,
  ms = 20_000
): Promise<boolean> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (notifications.seen().includes(text)) return true
    await sleep(500)
  }
  return notifications.seen().includes(text)
}

// --- Servidor de actualizaciones (fase 4) -------------------------------------------

/**
 * Procesos con esta variable en su entorno. Tras instalar, electron-updater vuelve a abrir el
 * AppImage nuevo sin argumentos (sin --user-data-dir): se le dan su propio XDG_CONFIG_HOME y
 * XDG_CACHE_HOME (la caché del actualizador) para reconocerlo y para que no escriba en ~/.config
 * ni en ~/.cache.
 */
function processesWithEnv(entry: string): number[] {
  const found: number[] = []
  for (const name of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(name) || Number(name) === process.pid) continue
    try {
      if (fs.readFileSync(`/proc/${name}/environ`, 'utf8').split('\0').includes(entry)) found.push(Number(name))
    } catch {
      // Ya terminó, o no es nuestro
    }
  }
  return found
}

/**
 * Cierra todas las instancias del AppImage de la prueba. Cerrar una instancia que tenga una
 * actualización descargada la instala al salir y abre otra, así que se repite hasta que no quede
 * ninguna.
 */
async function killAppImages(): Promise<number[]> {
  const killed: number[] = []
  for (let round = 0; round < 15; round++) {
    const pids = processesWithEnv(`XDG_CONFIG_HOME=${appImageXdg}`)
    if (pids.length === 0) break
    for (const pid of pids) {
      try {
        process.kill(pid, 'SIGTERM')
        killed.push(pid)
      } catch {
        // Ya terminó
      }
    }
    await sleep(2000)
  }
  return killed
}

/** XDG_CONFIG_HOME del AppImage de la fase 4 (vacío si no se ha llegado a ella). */
let appImageXdg = ''

/** Sirve como versión 9.9.9 una copia del mismo AppImage, con su latest-linux.yml. */
function serveUpdate(appImage: string): http.Server {
  const data = fs.readFileSync(appImage)
  const sha512 = createHash('sha512').update(data).digest('base64')
  const file = 'AbsorCheck-9.9.9.AppImage'
  const yml = [
    'version: 9.9.9',
    'files:',
    `  - url: ${file}`,
    `    sha512: ${sha512}`,
    `    size: ${data.length}`,
    `path: ${file}`,
    `sha512: ${sha512}`,
    `releaseDate: '${new Date().toISOString()}'`,
    ''
  ].join('\n')
  // Sin peticiones por rangos: la descarga diferencial falla y se descarga entera
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith('/latest-linux.yml')) {
      res.writeHead(200, { 'Content-Type': 'text/yaml' }).end(yml)
    } else if (req.url?.startsWith(`/${file}`)) {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': data.length }).end(data)
    } else {
      res.writeHead(404).end()
    }
  })
  server.listen(UPDATE_PORT, '127.0.0.1')
  return server
}

// --- Prueba ---------------------------------------------------------------------

let pc: ChildProcess | null = null
let controller: ChildProcess | null = null
let notifications: Awaited<ReturnType<typeof watchNotifications>> | null = null
let updateServer: http.Server | null = null

async function run(): Promise<void> {
  if (!WORK) throw new Error('Falta --work')
  fs.rmSync(WORK, { recursive: true, force: true })
  observerToken = await login('Observador de prueba')
  notifications = await watchNotifications()
  // Lo que puso desktop-stub.py porque el escritorio no lo tenía
  report.desktop = notifications.offered
  console.log(`Escritorio de prueba: ${notifications.offered}`)

  // A con su ventana (para cerrar sesión desde Ajustes) y B, el controlador
  await preparePc(PC_DATA, PC_NAME, await login(PC_NAME))
  pc = launch(PC_DATA, [`--remote-debugging-port=${PC_PORT}`])
  writeSession(CONTROLLER_DATA, await login(CONTROLLER_NAME))
  controller = launch(CONTROLLER_DATA, [`--remote-debugging-port=${CONTROLLER_PORT}`])
  const pcUi = await mainPage(PC_PORT)
  let ui = await mainPage(CONTROLLER_PORT)
  const ready = await waitDevice(PC_NAME, (d) => d?.online === true && d.remote.state === 'available', 40_000)
  check('preparación: A aparece disponible en la cuenta', ready?.remote.state === 'available', ready)

  // 1. A cierra sesión mientras B lo controla
  let { viewer, connected } = await connect(ui, PC_NAME)
  check('1. B controla A', connected, connected)
  const trayActive = await waitTray(pc, `Controlado ahora desde ${CONTROLLER_NAME}`)
  check('1. la bandeja de A dice que lo controla B', Array.isArray(trayActive) && trayActive.includes(`Controlado ahora desde ${CONTROLLER_NAME}`), trayActive)

  const signedOut = await signOutFromSettings(pcUi)
  const message = await viewerMessage(viewer, SIGNED_OUT_TEXT)
  check('1. al cerrar sesión en A, el visor de B dice que el PC ha cerrado la sesión de la cuenta', signedOut && message === SIGNED_OUT_TEXT, { signedOut, message })
  const authShown = await pcUi.waitFor<boolean>(`!!document.getElementById('auth-email')`, (v) => v === true, 10_000)
  check('1. A vuelve a la pantalla de acceso', authShown === true, authShown)
  const gone = await waitDevice(PC_NAME, (d) => d === undefined, 15_000)
  await sleep(8_000)
  const stillGone = await device(PC_NAME)
  check('1. A deja de aparecer en la cuenta y no vuelve a registrarse solo', gone === undefined && stillGone === undefined, { gone, after8s: stillGone })
  const hostWindows = (await targets(PC_PORT)).filter((t) => t.url.includes('host.html')).length
  check('1. A ya no tiene la ventana de la sesión', hostWindows === 0, { hostWindows })
  const trayOff = await waitTray(pc, 'Control remoto: desactivado')
  check('1. la bandeja de A dice "Control remoto: desactivado"', Array.isArray(trayOff) && trayOff.includes('Control remoto: desactivado'), trayOff)
  await viewer.eval('window.close()').catch(() => undefined)
  viewer.close()

  // Al volver a entrar en A, vuelve a estar disponible sin tocar nada más
  await typeInto(pcUi, '#auth-email', TEST_EMAIL)
  await typeInto(pcUi, '#auth-password', ACCOUNT_PASSWORD)
  await pcUi.eval(`document.querySelector('form.form-stack').requestSubmit()`)
  const back = await waitDevice(PC_NAME, (d) => d?.online === true && d.remote.state === 'available', 30_000)
  check('1. al volver a iniciar sesión en A, vuelve a estar disponible', back?.online === true && back.remote.state === 'available', back)
  pcUi.close()

  // 2. B cierra sesión con el visor abierto
  ;({ viewer, connected } = await connect(ui, PC_NAME))
  check('2. B vuelve a controlar A', connected, connected)
  const controllerSignedOut = await signOutFromSettings(ui)
  let closed = false
  for (let i = 0; i < 20 && !closed; i++) {
    closed = !(await viewerOpen())
    if (!closed) await sleep(500)
  }
  check('2. al cerrar sesión en B, su visor se cierra', controllerSignedOut && closed, { controllerSignedOut, closed })
  viewer.close()
  const freed = await waitDevice(PC_NAME, (d) => d?.remote.state === 'available', 20_000)
  const trayFree = await waitTray(pc, 'Control remoto: disponible')
  check('2. A queda libre: disponible en la cuenta y en su bandeja', freed?.remote.state === 'available' && Array.isArray(trayFree) && trayFree.includes('Control remoto: disponible'), { state: freed?.remote.state, tray: trayFree })
  ui.close()

  // 3. La sesión de A caduca con A en la bandeja (sin ventana) y B conectado
  check('3. preparación: A y B se cierran', (await stop(pc)) && (await stop(controller)), null)
  const pcToken = await login(PC_NAME)
  writeSession(PC_DATA, pcToken)
  pc = launch(PC_DATA, ['--hidden', `--remote-debugging-port=${PC_PORT}`])
  writeSession(CONTROLLER_DATA, await login(CONTROLLER_NAME))
  controller = launch(CONTROLLER_DATA, [`--remote-debugging-port=${CONTROLLER_PORT}`])
  ui = await mainPage(CONTROLLER_PORT)
  ;({ viewer, connected } = await connect(ui, PC_NAME))
  const pcWindows = (await targets(PC_PORT)).filter((t) => t.url.endsWith('index.html')).length
  check('3. B controla A, que está en la bandeja sin ventana', connected && pcWindows === 0, { connected, pcWindows })

  const revoked = await api('POST', '/api/auth/logout', pcToken)
  const expiredMessage = await viewerMessage(viewer, SIGNED_OUT_TEXT)
  check('3. al caducar la sesión de A, el visor de B dice que el PC ha cerrado la sesión de la cuenta', expiredMessage === SIGNED_OUT_TEXT, { revoked: revoked.status, message: expiredMessage })
  const notified = await waitNotification(notifications, 'La sesión de la cuenta ha caducado')
  check('3. A muestra la notificación de que hay que volver a iniciar sesión', notified, notified ? 'vista' : notifications.seen().slice(-600))
  const offline = await waitDevice(PC_NAME, (d) => d?.online === false, 50_000)
  check('3. A deja de estar en línea en la cuenta', offline?.online === false, offline)
  const trayExpired = await waitTray(pc, 'Control remoto: desactivado')
  check('3. A sigue en marcha, con "Control remoto: desactivado" en la bandeja', alive(pc) && Array.isArray(trayExpired) && trayExpired.includes('Control remoto: desactivado'), { alive: alive(pc), tray: trayExpired })
  await viewer.eval('window.close()').catch(() => undefined)
  viewer.close()
  await stop(pc)
  pc = null

  if (args.appimage) await updatePhase(ui, path.resolve(args.appimage))
  ui.close()
}

/** 4. Actualización descargada durante una sesión (app-updates), con un AppImage 0.0.1. */
async function updatePhase(ui: Page, source: string): Promise<void> {
  const dir = path.join(WORK, 'pc-appimage')
  const appImage = path.join(dir, 'AbsorCheck.AppImage')
  fs.mkdirSync(dir, { recursive: true })
  fs.copyFileSync(source, appImage)
  fs.chmodSync(appImage, 0o755)
  const inode = fs.statSync(appImage).ino
  updateServer = serveUpdate(appImage)

  await preparePc(dir, PC_UPDATE_NAME, await login(PC_UPDATE_NAME))
  appImageXdg = path.join(dir, 'xdg')
  fs.mkdirSync(path.join(dir, 'xdg-cache'), { recursive: true })
  fs.mkdirSync(appImageXdg, { recursive: true })
  pc = launch(dir, [`--remote-debugging-port=${PC_PORT}`], appImage, {
    XDG_CONFIG_HOME: appImageXdg,
    XDG_CACHE_HOME: path.join(dir, 'xdg-cache')
  })
  const pcUi = await mainPage(PC_PORT)
  const version = await pcUi.eval<string>('window.api.getAppVersion()')
  const notified = await waitNotification(notifications!, 'Hay una versión nueva disponible (9.9.9)', 30_000)
  check('4. el AppImage 0.0.1 avisa al arrancar de la versión 9.9.9', version === '0.0.1' && notified, { version, notified })
  const trayUpdate = await waitTray(pc, 'Descargar la versión 9.9.9')
  check('4. la bandeja ofrece descargar la 9.9.9', Array.isArray(trayUpdate) && trayUpdate.includes('Descargar la versión 9.9.9'), trayUpdate)

  const { viewer, connected } = await connect(ui, PC_UPDATE_NAME)
  check('4. B controla el AppImage', connected, connected)

  await pcUi.eval(`document.querySelector('button[title="Ajustes"]').click()`)
  await pcUi.waitFor<boolean>(`document.body.innerText.includes('Comprobar actualizaciones')`, (v) => v === true, 10_000)
  await clickText(pcUi, 'Comprobar actualizaciones')
  await pcUi.waitFor<boolean>(`document.body.innerText.includes('Descargar actualización')`, (v) => v === true, 30_000)
  await clickText(pcUi, 'Descargar actualización')
  const downloaded = await pcUi.waitFor<boolean>(`document.body.innerText.includes('Actualización descargada')`, (v) => v === true, 180_000)
  check('4. la actualización se descarga durante la sesión', downloaded === true, downloaded)

  const framesBefore = await framesOf(viewer)
  await clickText(pcUi, 'Reiniciar y actualizar')
  await sleep(6_000)
  const text = await pageText(pcUi)
  const explained = text.includes('Ahora mismo otro equipo controla este PC')
  check('4. "Reiniciar y actualizar" con la sesión en curso no reinicia y lo explica', alive(pc) && explained, { alive: alive(pc), explained })
  const framesAfter = await framesOf(viewer)
  const status = await viewer.eval<string>(`document.getElementById('overlay').hidden ? document.getElementById('status').textContent : 'aviso: ' + document.getElementById('message').textContent`)
  check('4. la sesión continúa: siguen llegando imágenes', framesAfter > framesBefore && /fps/.test(status), { framesBefore, framesAfter, status })
  check('4. el AppImage no se ha reemplazado todavía', fs.statSync(appImage).ino === inode, null)

  // Sin sesión, el mismo botón instala la versión nueva y cierra la app
  await viewer.eval(`document.getElementById('disconnect').click()`).catch(() => undefined)
  viewer.close()
  await waitDevice(PC_UPDATE_NAME, (d) => d?.remote.state === 'available', 20_000)
  const defaultData = path.join(appImageXdg, 'absor-connect-check')
  const defaultDataBefore = fs.existsSync(defaultData)
  await clickText(pcUi, 'Reiniciar y actualizar').catch(() => false)
  const quit = await exited(pc!, 30_000)
  let replaced = false
  for (let i = 0; i < 20 && !replaced; i++) {
    replaced = fs.existsSync(appImage) && fs.statSync(appImage).ino !== inode
    if (!replaced) await sleep(500)
  }
  check('4. sin sesión, "Reiniciar y actualizar" cierra la app e instala el AppImage nuevo', quit && replaced, { quit, replaced })
  // Y la vuelve a abrir (ya con la versión nueva; aquí, el mismo AppImage), con sus datos por defecto
  let reopened = false
  for (let i = 0; i < 40 && !reopened; i++) {
    reopened = !defaultDataBefore && fs.existsSync(defaultData)
    if (!reopened) await sleep(500)
  }
  check('4. después de instalar, la app se vuelve a abrir', reopened, { reopened, defaultDataBefore })
  pcUi.close()
  pc = null
  // Sin servidor, la instancia reabierta ya no encuentra la 9.9.9
  updateServer?.close()
  updateServer = null
  await killAppImages()
}

run()
  .catch((error) => {
    report.error = String(error instanceof Error ? (error.stack ?? error) : error)
    console.error(error)
  })
  .finally(async () => {
    updateServer?.close()
    for (const child of children) child.kill('SIGTERM')
    if (appImageXdg) await killAppImages()
    notifications?.stop()
    await sleep(2500)
    if (args.out) fs.writeFileSync(args.out, JSON.stringify(report, null, 2))
    const failed = report.checks.filter((c) => !c.ok).length
    console.log(`\n${report.checks.length - failed}/${report.checks.length} comprobaciones bien.`)
    process.exit(failed === 0 && !report.error ? 0 : 1)
  })

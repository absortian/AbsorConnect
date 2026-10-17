// Lo que quedaba de la 6.5 y se puede probar en un solo Linux, con el backend de desarrollo:
//   1. Alt+Tab y la tecla Windows en pantalla completa (`keyboard.lock()`). El controlador va en
//      el X del escritorio con un gestor de ventanas (metacity si no hay ninguno en marcha), y las
//      teclas se pulsan de verdad con XTest. Primero, como control, con la ventana normal: ahí el
//      gestor se queda Alt+Tab. Después en pantalla completa, donde deben ir al PC.
//   2. El controlador en Wayland, dentro de un compositor anidado (`muffin --wayland --nested`):
//      imagen, ratón, teclado y pantalla completa.
// El PC va en otro servidor X (Xephyr :77): si estuviera en el mismo, lo que inyecta volvería al
// visor en bucle. Lo que envía el visor se lee del canal `input` (se envuelve RTCDataChannel.send).
//
//   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron prototypes/remote-desktop/fullscreen-check/out/main.cjs \
//     --api=http://127.0.0.1:8020 --work=<carpeta temporal> --out=<fichero.json>
import { ChildProcess, execFileSync, spawn } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import koffi from 'koffi'
import { Page, waitTarget } from '../lib/cdp'
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
const WORK = args.work ?? ''
const DESKTOP = process.env.DISPLAY ?? ':0'
const PC_DISPLAY = ':77'
const PC_SIZE = { width: 3200, height: 1200 }
const RUNTIME_DIR = process.env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid?.() ?? 1000}`
const PC_PORT = 9334
const X11_PORT = 9333
const WAYLAND_PORT = 9335
const TEST_EMAIL = 'prueba-control-local@example.test'
const ACCOUNT_PASSWORD = 'contraseña-de-prueba-larga'
const PC_PASSWORD = 'contraseña-del-pc-prueba'
const PC_NAME = `PC de prueba Xephyr ${new Date().toTimeString().slice(0, 8)}`

interface Check {
  name: string
  ok: boolean
  detail: unknown
}
const report: { checks: Check[]; notes: string[]; error: string | null } = { checks: [], notes: [], error: null }
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function check(name: string, ok: boolean, detail: unknown): void {
  report.checks.push({ name, ok, detail })
  console.log(`${ok ? 'OK   ' : 'FALLO'} ${name} ${String(JSON.stringify(detail)).slice(0, 400)}`)
}

function note(text: string): void {
  report.notes.push(text)
  console.log(`NOTA  ${text}`)
}

async function login(deviceName: string): Promise<string> {
  const body = { email: TEST_EMAIL, password: ACCOUNT_PASSWORD, deviceName }
  const call = async (pathname: string): Promise<{ status: number; data: any }> => {
    const response = await fetch(`${API}${pathname}`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    return { status: response.status, data: await response.json().catch(() => null) }
  }
  let result = await call('/api/auth/login')
  if (result.status !== 200) result = await call('/api/auth/register')
  if (typeof result.data?.token !== 'string') throw new Error(`Sin sesión: ${JSON.stringify(result)}`)
  return result.data.token
}

function writeSession(dir: string, token: string): void {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify({ email: TEST_EMAIL, token, encrypted: false }))
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ theme: 'dark', language: 'es', keepInBackground: false, openAtLogin: false }))
}

// --- Procesos --------------------------------------------------------------------

const processes: ChildProcess[] = []

function start(command: string, argv: string[], env: Record<string, string>, log: string): ChildProcess {
  const out = fs.openSync(log, 'a')
  const child = spawn(command, argv, { env: { ...process.env, ...env }, stdio: ['ignore', out, out] })
  processes.push(child)
  return child
}

function launchApp(dir: string, port: number, env: Record<string, string>, extra: string[] = []): ChildProcess {
  return start(ELECTRON, [ROOT, `--user-data-dir=${dir}`, `--remote-debugging-port=${port}`, ...extra], { ABSOR_CONNECT_API_URL: API, ELECTRON_RUN_AS_NODE: '', ...env }, path.join(dir, 'app.log'))
}

async function stop(child: ChildProcess | null): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise((resolve) => child.once('exit', resolve))
  child.kill('SIGTERM')
  if ((await Promise.race([exited, sleep(10_000).then(() => 'timeout')])) === 'timeout') child.kill('SIGKILL')
}

function sh(command: string, argv: string[], env: Record<string, string> = {}): string {
  try {
    return execFileSync(command, argv, { encoding: 'utf8', env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000 }).trim()
  } catch (error) {
    return `ERROR ${String((error as { stderr?: string }).stderr ?? error).slice(0, 200)}`
  }
}

/** Hay un gestor de ventanas en marcha en el X del escritorio (su ventana de comprobación existe). */
function windowManager(): string | null {
  const id = sh('xprop', ['-root', '_NET_SUPPORTING_WM_CHECK']).match(/window id # (0x[0-9a-f]+)/)?.[1]
  if (!id) return null
  const name = sh('xprop', ['-id', id, '_NET_WM_NAME'])
  return name.startsWith('ERROR') ? null : (name.match(/"(.*)"/)?.[1] ?? 'desconocido')
}

// --- X11: teclas de verdad en el escritorio y el ratón del PC ------------------------

const x11 = koffi.load('libX11.so.6')
const xtst = koffi.load('libXtst.so.6')
const XOpenDisplay = x11.func('void *XOpenDisplay(const char *name)')
const XFlush = x11.func('int XFlush(void *display)')
const XKeysymToKeycode = x11.func('uint8_t XKeysymToKeycode(void *display, unsigned long keysym)')
const XDefaultRootWindow = x11.func('unsigned long XDefaultRootWindow(void *display)')
const XQueryPointer = x11.func('int XQueryPointer(void *d, unsigned long w, _Out_ unsigned long *root, _Out_ unsigned long *child, _Out_ int *rx, _Out_ int *ry, _Out_ int *wx, _Out_ int *wy, _Out_ unsigned int *mask)')
const XTestFakeKeyEvent = xtst.func('int XTestFakeKeyEvent(void *display, unsigned int keycode, int isPress, unsigned long delay)')

const KEYSYM = { Alt_L: 0xffe9, Tab: 0xff09, Super_L: 0xffeb }

/** Pulsa una combinación con XTest, como un teclado de verdad (el gestor de ventanas la ve). */
async function press(display: unknown, keys: (keyof typeof KEYSYM)[]): Promise<void> {
  const codes = keys.map((k) => XKeysymToKeycode(display, KEYSYM[k]))
  for (const code of codes) {
    XTestFakeKeyEvent(display, code, 1, 0)
    XFlush(display)
    await sleep(80)
  }
  for (const code of [...codes].reverse()) {
    XTestFakeKeyEvent(display, code, 0, 0)
    XFlush(display)
    await sleep(80)
  }
}

function pointer(display: unknown): { x: number; y: number } {
  const out = [[0], [0], [0], [0], [0], [0], [0]]
  XQueryPointer(display, XDefaultRootWindow(display), ...out)
  return { x: out[2][0], y: out[3][0] }
}

// --- El visor --------------------------------------------------------------------

interface Sent {
  type: string
  code?: string
  down?: boolean
}

/** Equipos → Conectar; antes de la contraseña se empieza a anotar lo que va por el canal `input`. */
async function connect(port: number): Promise<{ ui: Page; viewer: Page; connected: boolean }> {
  const ui = await Page.open(await waitTarget(port, (t) => t.url.endsWith('index.html'), 60_000))
  await ui.waitFor<boolean>(`!!document.querySelector('button[title="Equipos"]')`, (v) => v === true, 30_000)
  await ui.eval(`document.querySelector('button[title="Equipos"]').click()`)
  await ui.waitFor<string>(`[...document.querySelectorAll('.settings-row')].find((r) => r.innerText.includes(${JSON.stringify(PC_NAME)}))?.innerText ?? ''`, (t) => t.includes('Disponible'), 40_000)
  await ui.eval(`[...document.querySelectorAll('.settings-row')].find((r) => r.innerText.includes(${JSON.stringify(PC_NAME)})).querySelector('button').click()`)
  const viewer = await Page.open(await waitTarget(port, (t) => t.url.includes('viewer.html')))
  await viewer.waitFor<boolean>(`!!document.getElementById('password')`, (v) => v === true, 15_000)
  await viewer.eval(`(() => {
    window.__sent = []
    const send = RTCDataChannel.prototype.send
    RTCDataChannel.prototype.send = function (data) {
      if (this.label === 'input' && typeof data === 'string') window.__sent.push(JSON.parse(data))
      return send.call(this, data)
    }
  })()`)
  await viewer.eval(`(() => { document.getElementById('password').value = ${JSON.stringify(PC_PASSWORD)}; document.getElementById('login').requestSubmit() })()`)
  const connected = await viewer.waitFor<boolean>(`document.getElementById('overlay').hidden && document.getElementById('video').videoWidth > 0`, (v) => v === true, 30_000)
  return { ui, viewer, connected: connected === true }
}

const sent = (viewer: Page): Promise<Sent[]> => viewer.eval<Sent[]>(`window.__sent.splice(0)`)
const keyDown = (list: Sent[], code: string): boolean => list.some((m) => m.type === 'key' && m.code === code && m.down === true)
const keysOf = (list: Sent[]): string[] => list.map((m) => (m.type === 'key' ? `${m.code}${m.down ? '↓' : '↑'}` : m.type))

async function clickFullscreen(viewer: Page): Promise<boolean> {
  const at = await viewer.eval<{ x: number; y: number }>(`(() => { const r = document.getElementById('fullscreen').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
  await viewer.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', clickCount: 1 })
  await viewer.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'left', clickCount: 1 })
  return (await viewer.waitFor<boolean>(`!!document.fullscreenElement`, (v) => v === true, 8000)) === true
}

const focused = (viewer: Page): Promise<boolean> => viewer.eval<boolean>(`document.hasFocus()`)

// --- Prueba ---------------------------------------------------------------------

async function run(): Promise<void> {
  if (!WORK) throw new Error('Falta --work')
  fs.rmSync(WORK, { recursive: true, force: true })
  fs.mkdirSync(WORK, { recursive: true })

  // El PC, en su propio servidor X
  start('Xephyr', [PC_DISPLAY, '-screen', `${PC_SIZE.width}x${PC_SIZE.height}`, '-ac', '-br', '-nolisten', 'tcp'], {}, path.join(WORK, 'xephyr.log'))
  await sleep(2000)
  const pcDir = path.join(WORK, 'pc')
  writeSession(pcDir, await login(PC_NAME))
  const store = new RemoteAccessStore(path.join(pcDir, 'remote-access.json'), createPlaintextBox(), PC_NAME)
  await store.bindToAccount(TEST_EMAIL)
  await store.setPassword(PC_PASSWORD)
  await store.setDeviceName(PC_NAME)
  await store.setEnabled(true)
  launchApp(pcDir, PC_PORT, { DISPLAY: PC_DISPLAY }, ['--hidden'])
  const pcX = XOpenDisplay(PC_DISPLAY)

  // 1. Alt+Tab en pantalla completa, con un gestor de ventanas
  let wm = windowManager()
  let startedWm: ChildProcess | null = null
  if (!wm) {
    startedWm = start('metacity', ['--replace'], {}, path.join(WORK, 'metacity.log'))
    for (let i = 0; i < 20 && !wm; i++) {
      await sleep(500)
      wm = windowManager()
    }
    note(`no había gestor de ventanas en ${DESKTOP}: se ha arrancado ${wm ?? 'metacity (sin respuesta)'} para la prueba`)
  }
  check('1. hay un gestor de ventanas en el escritorio', !!wm, wm)

  const x11Dir = path.join(WORK, 'controlador-x11')
  writeSession(x11Dir, await login('Controlador X11 de prueba'))
  launchApp(x11Dir, X11_PORT, {})
  const desktop = XOpenDisplay(DESKTOP)
  let { ui, viewer, connected } = await connect(X11_PORT)
  check('1. el controlador (X11) controla el PC de Xephyr', connected, connected)

  // Control: con la ventana normal, Alt+Tab es del gestor de ventanas
  await viewer.send('Page.bringToFront')
  await viewer.waitFor<boolean>(`document.hasFocus()`, (v) => v === true, 5000)
  await sent(viewer)
  await press(desktop, ['Alt_L', 'Tab'])
  await sleep(1000)
  const windowed = await sent(viewer)
  check('1. con la ventana normal, Alt+Tab no llega al PC (se lo queda el gestor de ventanas)', !keyDown(windowed, 'Tab'), keysOf(windowed))

  // En pantalla completa, con keyboard.lock(), Alt+Tab y la tecla Windows van al PC
  await viewer.send('Page.bringToFront')
  await viewer.waitFor<boolean>(`document.hasFocus()`, (v) => v === true, 5000)
  const full = await clickFullscreen(viewer)
  await sleep(1500)
  await sent(viewer)
  await press(desktop, ['Alt_L', 'Tab'])
  await sleep(1000)
  const locked = await sent(viewer)
  const stillFull = await viewer.eval<boolean>(`!!document.fullscreenElement`)
  check('1. en pantalla completa, Alt+Tab llega al PC y el visor sigue delante', full && keyDown(locked, 'AltLeft') && keyDown(locked, 'Tab') && stillFull && (await focused(viewer)), { full, stillFull, keys: keysOf(locked) })
  await press(desktop, ['Super_L'])
  await sleep(800)
  const superKey = await sent(viewer)
  check('1. en pantalla completa, la tecla Windows llega al PC', keyDown(superKey, 'MetaLeft'), keysOf(superKey))
  await viewer.eval(`void document.exitFullscreen().catch(() => undefined)`)
  const exited = await viewer.waitFor<boolean>(`!document.fullscreenElement`, (v) => v === true, 8000)
  await sleep(500)
  await sent(viewer)
  await press(desktop, ['Alt_L', 'Tab'])
  await sleep(1000)
  const after = await sent(viewer)
  check('1. al salir de la pantalla completa, Alt+Tab vuelve a ser del gestor de ventanas', exited === true && !keyDown(after, 'Tab'), { exited, keys: keysOf(after) })
  await viewer.eval(`window.close()`).catch(() => undefined)
  viewer.close()
  ui.close()
  if (startedWm) await stop(startedWm)

  // 2. El controlador en Wayland (compositor anidado)
  const before = new Set(fs.readdirSync(RUNTIME_DIR))
  const compositor = start('muffin', ['--wayland', '--nested', '--no-x11'], {}, path.join(WORK, 'muffin.log'))
  let socket = ''
  for (let i = 0; i < 20 && !socket; i++) {
    await sleep(500)
    socket = fs.readdirSync(RUNTIME_DIR).find((f) => /^wayland-\d+$/.test(f) && !before.has(f)) ?? ''
  }
  check('2. hay un compositor Wayland anidado', socket !== '', socket || 'sin socket nuevo')
  if (socket) {
    const waylandDir = path.join(WORK, 'controlador-wayland')
    writeSession(waylandDir, await login('Controlador Wayland de prueba'))
    launchApp(waylandDir, WAYLAND_PORT, { WAYLAND_DISPLAY: socket, XDG_SESSION_TYPE: 'wayland' }, ['--ozone-platform=wayland'])
    ;({ ui, viewer, connected } = await connect(WAYLAND_PORT))
    const platform = await ui.eval<string>(`navigator.userAgentData?.platform ?? navigator.platform`)
    await sleep(2000)
    const status = await viewer.eval<string>(`document.getElementById('status').textContent`)
    check('2. en Wayland, el visor se conecta y llega la imagen', connected && /fps/.test(status), { connected, status, platform })

    const target = await viewer.eval<{ x: number; y: number }>(`(() => {
      const v = document.getElementById('video'); const r = v.getBoundingClientRect()
      const s = Math.min(r.width / v.videoWidth, r.height / v.videoHeight)
      const w = v.videoWidth * s, h = v.videoHeight * s
      return { x: r.left + (r.width - w) / 2 + w * 0.25, y: r.top + (r.height - h) / 2 + h * 0.25 }
    })()`)
    await viewer.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: target.x, y: target.y })
    await sleep(800)
    const at = pointer(pcX)
    const expected = { x: PC_SIZE.width * 0.25, y: PC_SIZE.height * 0.25 }
    check('2. en Wayland, mover el ratón sobre la imagen lo mueve en el PC al punto equivalente', Math.abs(at.x - expected.x) <= 4 && Math.abs(at.y - expected.y) <= 4, { at, expected })

    await sent(viewer)
    await viewer.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyA', key: 'a', text: 'a', windowsVirtualKeyCode: 65 })
    await viewer.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyA', key: 'a', windowsVirtualKeyCode: 65 })
    await sleep(500)
    const typed = await sent(viewer)
    check('2. en Wayland, las teclas van al PC por su posición', keyDown(typed, 'KeyA') && typed.some((m) => m.code === 'KeyA' && m.down === false), keysOf(typed))

    const waylandFull = await clickFullscreen(viewer)
    await viewer.eval(`void document.exitFullscreen().catch(() => undefined)`)
    const waylandBack = await viewer.waitFor<boolean>(`!document.fullscreenElement`, (v) => v === true, 8000)
    check('2. en Wayland, la pantalla completa entra y sale', waylandFull && waylandBack === true, { waylandFull, waylandBack })
    await viewer.eval(`window.close()`).catch(() => undefined)
    viewer.close()
    ui.close()
  }
  await stop(compositor)
  // muffin deja su socket al cerrarse
  if (socket) for (const file of [socket, `${socket}.lock`]) fs.rmSync(path.join(RUNTIME_DIR, file), { force: true })
}

run()
  .catch((error) => {
    report.error = String(error instanceof Error ? (error.stack ?? error) : error)
    console.error(error)
  })
  .finally(async () => {
    for (const child of [...processes].reverse()) await stop(child)
    if (args.out) fs.writeFileSync(args.out, JSON.stringify(report, null, 2))
    const failed = report.checks.filter((c) => !c.ok).length
    console.log(`\n${report.checks.length - failed}/${report.checks.length} comprobaciones bien.`)
    process.exit(failed === 0 && !report.error ? 0 : 1)
  })

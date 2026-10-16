// Prueba del visor (tareas 4.9, 6.4 y 6.5) con dos instancias de la app de verdad en un Linux X11 y
// el backend de desarrollo: A hace de PC controlado (oculta) y B de controlador. B se maneja desde
// fuera por el protocolo de DevTools (--remote-debugging-port), como lo haría una persona: Equipos →
// Conectar → contraseña en la ventana de visor. Se ejecuta con Node (o Electron como Node):
//
//   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron prototypes/remote-desktop/viewer-check/out/main.cjs \
//     --api=http://127.0.0.1:8020 --work=<carpeta temporal> --out=<fichero.json>
//
// Mueve el ratón a una zona de la pantalla que no tapa el visor (si no, el cursor movido por A caería
// sobre el visor de B y volvería a A en bucle), no hace clics en el PC y mata una vez el renderer
// `host` de A para comprobar la reconexión.
import { ChildProcess, spawn } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import koffi from 'koffi'
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
const HOST_DATA = path.join(WORK, 'pc')
const VIEWER_DATA = path.join(WORK, 'controlador')
const DEBUG_PORT = 9333
/** DevTools del PC (A): solo para hacer fallar el renderer de la sesión con Page.crash. */
const PC_DEBUG_PORT = 9334
const TEST_EMAIL = 'prueba-control-local@example.test'
const ACCOUNT_PASSWORD = 'contraseña-de-prueba-larga'
const PC_PASSWORD = 'contraseña-del-pc-prueba'
const PC_NAME = `PC de prueba ${new Date().toTimeString().slice(0, 8)}`

interface Check {
  name: string
  ok: boolean
  detail: unknown
}
const report: { checks: Check[]; error: string | null } = { checks: [], error: null }
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function check(name: string, ok: boolean, detail: unknown): void {
  report.checks.push({ name, ok, detail })
  console.log(`${ok ? 'OK   ' : 'FALLO'} ${name} ${JSON.stringify(detail).slice(0, 400)}`)
}

async function api(method: string, pathname: string, token?: string, body?: unknown): Promise<{ status: number; data: any }> {
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
  let result = await api('POST', '/api/auth/login', undefined, { email: TEST_EMAIL, password: ACCOUNT_PASSWORD, deviceName })
  if (result.status !== 200) {
    result = await api('POST', '/api/auth/register', undefined, { email: TEST_EMAIL, password: ACCOUNT_PASSWORD, deviceName })
  }
  if (typeof result.data?.token !== 'string') throw new Error(`Sin sesión de prueba: ${JSON.stringify(result)}`)
  return result.data.token
}

function writeSession(dir: string, token: string): void {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify({ email: TEST_EMAIL, token, encrypted: false }))
  fs.writeFileSync(
    path.join(dir, 'settings.json'),
    JSON.stringify({ theme: 'dark', language: 'es', keepInBackground: false, openAtLogin: false })
  )
}

const children: ChildProcess[] = []

function launch(dir: string, extra: string[]): ChildProcess {
  const log = fs.openSync(path.join(dir, 'app.log'), 'a')
  const child = spawn(ELECTRON, [ROOT, `--user-data-dir=${dir}`, ...extra], {
    env: { ...process.env, ABSOR_CONNECT_API_URL: API, ELECTRON_RUN_AS_NODE: '' },
    stdio: ['ignore', log, log]
  })
  children.push(child)
  return child
}

// --- DevTools (CDP) ------------------------------------------------------------

interface Target {
  id: string
  type: string
  url: string
  webSocketDebuggerUrl: string
}

async function targets(port = DEBUG_PORT): Promise<Target[]> {
  try {
    return (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as Target[]
  } catch {
    return []
  }
}

async function waitTarget(match: (t: Target) => boolean, ms = 30_000): Promise<Target> {
  const deadline = Date.now() + ms
  for (;;) {
    const found = (await targets()).find((t) => t.type === 'page' && match(t))
    if (found) return found
    if (Date.now() > deadline) throw new Error('No aparece la ventana esperada')
    await sleep(500)
  }
}

class Page {
  private ws!: WebSocket
  private next = 1
  private pending = new Map<number, (value: any) => void>()

  static async open(target: Target): Promise<Page> {
    const page = new Page()
    page.ws = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      page.ws.onopen = resolve
      page.ws.onerror = reject
    })
    page.ws.onmessage = (event) => {
      const message = JSON.parse(String(event.data))
      if (message.id && page.pending.has(message.id)) {
        page.pending.get(message.id)!(message)
        page.pending.delete(message.id)
      }
    }
    return page
  }

  send(method: string, params: object = {}): Promise<any> {
    const id = this.next++
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve) => this.pending.set(id, resolve))
  }

  async eval<T>(expression: string): Promise<T> {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.result?.exceptionDetails) throw new Error(JSON.stringify(result.result.exceptionDetails).slice(0, 300))
    return result.result?.result?.value as T
  }

  async waitFor<T>(expression: string, ok: (value: T) => boolean, ms = 30_000): Promise<T> {
    const deadline = Date.now() + ms
    for (;;) {
      const value = await this.eval<T>(expression).catch(() => undefined as T)
      if (ok(value) || Date.now() > deadline) return value
      await sleep(500)
    }
  }

  close(): void {
    this.ws.close()
  }
}

// --- Ratón real (para comprobar dónde lo pone el PC) ------------------------------

function pointerReader(): () => { x: number; y: number } {
  const x11 = koffi.load('libX11.so.6')
  const XOpenDisplay = x11.func('void *XOpenDisplay(const char *name)')
  const XDefaultRootWindow = x11.func('unsigned long XDefaultRootWindow(void *display)')
  const XQueryPointer = x11.func(
    'int XQueryPointer(void *d, unsigned long w, _Out_ unsigned long *root, _Out_ unsigned long *child, _Out_ int *rx, _Out_ int *ry, _Out_ int *wx, _Out_ int *wy, _Out_ unsigned int *mask)'
  )
  const display = XOpenDisplay(null)
  return () => {
    const out = [[0], [0], [0], [0], [0], [0], [0]]
    XQueryPointer(display, XDefaultRootWindow(display), ...out)
    return { x: out[2][0], y: out[3][0] }
  }
}

async function run(): Promise<void> {
  if (!WORK) throw new Error('Falta --work')
  fs.rmSync(WORK, { recursive: true, force: true })
  const queryPointer = pointerReader()
  const pcToken = await login(PC_NAME)
  const viewerToken = await login('Controlador de prueba')

  // A: el PC controlado, oculto, con contraseña y control remoto activado
  writeSession(HOST_DATA, pcToken)
  const store = new RemoteAccessStore(path.join(HOST_DATA, 'remote-access.json'), createPlaintextBox(), PC_NAME)
  await store.bindToAccount(TEST_EMAIL)
  await store.setPassword(PC_PASSWORD)
  await store.setDeviceName(PC_NAME)
  await store.setEnabled(true)
  launch(HOST_DATA, ['--hidden', `--remote-debugging-port=${PC_DEBUG_PORT}`])

  // B: el controlador, con su interfaz
  writeSession(VIEWER_DATA, viewerToken)
  launch(VIEWER_DATA, [`--remote-debugging-port=${DEBUG_PORT}`])
  const mainTarget = await waitTarget((t) => t.url.endsWith('index.html'))
  const ui = await Page.open(mainTarget)

  // 1. Equipos: A disponible, B marcado como este equipo
  await ui.waitFor<boolean>(`!!document.querySelector('button[title="Equipos"]')`, (v) => v === true)
  await ui.eval(`document.querySelector('button[title="Equipos"]').click()`)
  const rows = await ui.waitFor<string>(
    `document.querySelector('.settings-panel')?.innerText ?? ''`,
    (text) => text.includes(PC_NAME) && text.includes('Disponible') && text.includes('este equipo'),
    40_000
  )
  check('Equipos: el PC aparece disponible y el propio equipo marcado, sin recargar', rows.includes(PC_NAME) && rows.includes('Disponible') && rows.includes('este equipo'), rows)

  // 4.9: el token no llega al renderer por los canales de la ventana principal
  const devicesReply = await ui.eval<unknown>(`window.api.remoteDevices()`)
  check('el token no aparece en lo que recibe la ventana principal', !JSON.stringify(devicesReply).includes(viewerToken) && !JSON.stringify(devicesReply).includes(pcToken), { length: JSON.stringify(devicesReply).length })

  // 2. Conectar → ventana de visor
  await ui.eval(`[...document.querySelectorAll('.settings-row')].find((r) => r.innerText.includes(${JSON.stringify(PC_NAME)})).querySelector('button').click()`)
  const viewerTarget = await waitTarget((t) => t.url.includes('viewer.html'))
  const viewer = await Page.open(viewerTarget)
  await viewer.waitFor<string>(`document.title`, (title) => title === PC_NAME, 10_000)
  check('la ventana de sesión se titula con el nombre del PC', (await viewer.eval<string>('document.title')) === PC_NAME, await viewer.eval('document.title'))

  const viewerReplies = await viewer.eval<unknown>(`Promise.all([window.absorViewer.init(), window.absorViewer.iceServers()])`)
  check('el token no aparece en lo que recibe la ventana de visor', !JSON.stringify(viewerReplies).includes(viewerToken), viewerReplies)
  const otherWindows = await viewer.eval<string>(`typeof window.api`)
  check('la ventana de visor solo tiene su propio puente (no window.api)', otherWindows === 'undefined', otherWindows)

  // Contraseña incorrecta: mensaje específico
  const submit = (password: string): Promise<unknown> =>
    viewer.eval(`(() => { const p = document.getElementById('password'); p.value = ${JSON.stringify(password)}; document.getElementById('login').requestSubmit(); })()`)
  await submit('contraseña-incorrecta')
  const wrong = await viewer.waitFor<string>(`document.getElementById('message').textContent`, (t) => t === 'Contraseña incorrecta.', 30_000)
  check('contraseña incorrecta: el visor lo explica', wrong === 'Contraseña incorrecta.', wrong)

  // Contraseña correcta: imagen y estado
  const started = Date.now()
  await submit(PC_PASSWORD)
  const connected = await viewer.waitFor<boolean>(`document.getElementById('overlay').hidden`, (v) => v === true, 30_000)
  const seconds = (Date.now() - started) / 1000
  await sleep(3000)
  const view = await viewer.eval<{ w: number; h: number; status: string; displaysHidden: boolean }>(
    `({ w: document.getElementById('video').videoWidth, h: document.getElementById('video').videoHeight, status: document.getElementById('status').textContent, displaysHidden: document.getElementById('displays').hidden })`
  )
  check('contraseña correcta: se abre la sesión en menos de 10 s y llega la imagen', connected === true && seconds < 10 && view.w > 0, { seconds, ...view })
  check('el estado muestra directa o relé, latencia y fps', /Directa|Por relé/.test(view.status) && /ms/.test(view.status) && /fps/.test(view.status), view.status)
  check('con una sola pantalla no hay selector', view.displaysHidden, view.displaysHidden)

  // Ratón: mover sobre la imagen al 10 % de la pantalla (fuera de la ventana del visor)
  const target = await viewer.eval<{ x: number; y: number }>(`(() => {
    const v = document.getElementById('video'); const r = v.getBoundingClientRect()
    const s = Math.min(r.width / v.videoWidth, r.height / v.videoHeight)
    const w = v.videoWidth * s, h = v.videoHeight * s
    return { x: r.left + (r.width - w) / 2 + w * 0.1, y: r.top + (r.height - h) / 2 + h * 0.1 }
  })()`)
  await viewer.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: target.x, y: target.y })
  await sleep(800)
  const at = queryPointer()
  check('mover el ratón sobre la imagen lo mueve en el PC al punto equivalente (10 %, 10 %)', Math.abs(at.x - 384) <= 3 && Math.abs(at.y - 216) <= 3, { at, expected: { x: 384, y: 216 } })

  // 3. Reconexión: falla el renderer de la sesión en el PC (Page.crash); el visor reconecta solo con K
  const hostTarget = (await targets(PC_DEBUG_PORT)).find((t) => t.type === 'page' && t.url.includes('host.html'))
  if (hostTarget) {
    const hostPage = await Page.open(hostTarget)
    void hostPage.send('Page.crash')
    await sleep(300)
    hostPage.close()
  }
  const lostAt = Date.now()
  // Cada cambio de lo que muestra el visor, con el segundo en que pasa
  const timeline: string[] = []
  let reconnected = false
  let sawReconnecting = false
  while (Date.now() - lostAt < 60_000) {
    const view = await viewer
      .eval<string>(`(document.getElementById('overlay').hidden ? 'sesión: ' + document.getElementById('status').textContent : 'aviso: ' + document.getElementById('message').textContent)`)
      .catch(() => 'sin respuesta')
    const second = Math.round((Date.now() - lostAt) / 1000)
    const { data } = await api('GET', '/api/devices', viewerToken)
    const pcState = data?.devices?.find((d: any) => d.name === PC_NAME)?.remote?.state ?? '?'
    const line = `${view} · PC ${pcState}`
    if (timeline.at(-1)?.split(' s · ')[1] !== line) timeline.push(`${second} s · ${line}`)
    if (view.includes('Reconectando')) sawReconnecting = true
    if (sawReconnecting && view.startsWith('sesión:') && view.includes('fps')) {
      reconnected = true
      break
    }
    await sleep(1000)
  }
  check('si se pierde la conexión, el visor reconecta solo sin pedir la contraseña', reconnected, { hostPageCrashed: !!hostTarget, timeline })

  // 4. Desconectar: cierra la ventana y el PC vuelve a estar disponible
  await viewer.eval(`document.getElementById('disconnect').click()`).catch(() => undefined)
  viewer.close()
  const deadline = Date.now() + 20_000
  let state = ''
  while (Date.now() < deadline) {
    const { data } = await api('GET', '/api/devices', viewerToken)
    state = data?.devices?.find((d: any) => d.name === PC_NAME)?.remote?.state ?? ''
    if (state === 'available') break
    await sleep(1000)
  }
  const viewerGone = !(await targets()).some((t) => t.url.includes('viewer.html'))
  check('Desconectar cierra la ventana y el PC vuelve a estar disponible', viewerGone && state === 'available', { viewerGone, state })
  ui.close()
}

run()
  .catch((error) => {
    report.error = String(error instanceof Error ? (error.stack ?? error) : error)
    console.error(error)
  })
  .finally(async () => {
    for (const child of children) child.kill('SIGTERM')
    await sleep(1500)
    if (args.out) fs.writeFileSync(args.out, JSON.stringify(report, null, 2))
    const failed = report.checks.filter((c) => !c.ok).length
    console.log(`\n${report.checks.length - failed}/${report.checks.length} comprobaciones bien.`)
    process.exit(failed === 0 && !report.error ? 0 : 1)
  })

// Prueba de punta a punta del PC controlado (tarea 4.8) en un solo equipo Linux X11, contra el backend
// de desarrollo: la app de verdad (out/, `electron-vite build`) hace de PC controlado, arrancada
// oculta y con su propia carpeta de datos, y esta ventana hace de controlador (controller.ts).
//
//   electron prototypes/remote-desktop/controller-check --api=http://127.0.0.1:8020 \
//     --host-data=<carpeta temporal> --out=<fichero.json>
//
// Usa una cuenta de prueba fija (la crea si no existe: el alta tiene un límite de 5 por hora y por
// IP) y un nombre de PC nuevo en cada ejecución; con --delete-account=1 la borra al terminar.
// Prepara la sesión y la contraseña del PC en la carpeta de datos, y recorre los escenarios de
// remote-access-host que no necesitan dos equipos.
// Mueve el ratón al centro de la pantalla principal y abre la pregunta de confirmación 30 s.
import { app, BrowserWindow, ipcMain, screen } from 'electron'
import { ChildProcess, execFileSync, spawn } from 'child_process'
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
const HOST_DATA = args['host-data']
const PC_PASSWORD = 'contraseña-del-pc-prueba'
const ACCOUNT_PASSWORD = 'contraseña-de-prueba-larga'
const TEST_EMAIL = 'prueba-control-local@example.test'
const PC_NAME = `PC de prueba ${new Date().toTimeString().slice(0, 8)}`
const NOTICE_TITLE = 'Absor Connect — aviso'

interface Check {
  name: string
  ok: boolean
  detail: unknown
}

const report: { checks: Check[]; error: string | null } = { checks: [], error: null }
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function check(name: string, ok: boolean, detail: unknown): void {
  report.checks.push({ name, ok, detail })
  console.log(`${ok ? 'OK   ' : 'FALLO'} ${name} ${JSON.stringify(detail)}`)
}

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

let host: ChildProcess | null = null

function startHost(): void {
  const log = fs.openSync(path.join(HOST_DATA, 'host.log'), 'a')
  host = spawn(
    path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron'),
    [ROOT, `--user-data-dir=${HOST_DATA}`, '--hidden'],
    { env: { ...process.env, ABSOR_CONNECT_API_URL: API }, stdio: ['ignore', log, log] }
  )
  const started = Date.now()
  host.once('exit', (code, signal) => {
    console.log(`PC (app) terminó: código ${code}, señal ${signal}, a los ${Math.round((Date.now() - started) / 1000)} s`)
  })
}

async function stopHost(): Promise<void> {
  if (!host) return
  const exited = new Promise((resolve) => host!.once('exit', resolve))
  host.kill('SIGTERM')
  await Promise.race([exited, sleep(5000)])
  host = null
}

async function setupHostData(email: string, token: string, confirmLocal: boolean): Promise<void> {
  fs.mkdirSync(HOST_DATA, { recursive: true })
  fs.writeFileSync(
    path.join(HOST_DATA, 'session.json'),
    JSON.stringify({ email, token, encrypted: false })
  )
  fs.writeFileSync(
    path.join(HOST_DATA, 'settings.json'),
    JSON.stringify({ theme: 'dark', language: 'es', keepInBackground: false, openAtLogin: false })
  )
  // La contraseña sin cifrar (prefijo p1:): la caja segura de la app también la lee
  const store = new RemoteAccessStore(
    path.join(HOST_DATA, 'remote-access.json'),
    createPlaintextBox(),
    PC_NAME
  )
  await store.bindToAccount(email)
  if (!(await store.hasPassword())) await store.setPassword(PC_PASSWORD)
  await store.setDeviceName(PC_NAME)
  await store.setEnabled(true)
  await store.setConfirmLocal(confirmLocal)
}

/** Equipo de prueba en la lista del controlador, cuando cumple `ok`. */
async function waitDevice(
  token: string,
  ok: (device: any) => boolean,
  ms = 40_000
): Promise<any> {
  const deadline = Date.now() + ms
  for (;;) {
    const { data } = await api('GET', '/api/devices', token)
    const device = data?.devices?.find((d: any) => d.name === PC_NAME)
    if ((device && ok(device)) || Date.now() > deadline) return device ?? null
    await sleep(1000)
  }
}

function windowTitles(): string {
  try {
    return execFileSync('xwininfo', ['-root', '-tree'], { encoding: 'utf8' })
  } catch {
    return ''
  }
}

let queryPointer: () => { x: number; y: number } = () => ({ x: -1, y: -1 })

function setupPointerQuery(): void {
  const x11 = koffi.load('libX11.so.6')
  const XOpenDisplay = x11.func('void *XOpenDisplay(const char *name)')
  const XDefaultRootWindow = x11.func('unsigned long XDefaultRootWindow(void *display)')
  const XQueryPointer = x11.func(
    'int XQueryPointer(void *d, unsigned long w, _Out_ unsigned long *root, _Out_ unsigned long *child, _Out_ int *rx, _Out_ int *ry, _Out_ int *wx, _Out_ int *wy, _Out_ unsigned int *mask)'
  )
  const display = XOpenDisplay(null)
  queryPointer = () => {
    const out = [[0], [0], [0], [0], [0], [0], [0]]
    XQueryPointer(display, XDefaultRootWindow(display), ...out)
    return { x: out[2][0], y: out[3][0] }
  }
}

async function run(): Promise<void> {
  if (!HOST_DATA) throw new Error('Falta --host-data')
  setupPointerQuery()

  const email = TEST_EMAIL
  const login = (deviceName: string): Promise<{ status: number; data: any }> =>
    api('POST', '/api/auth/login', undefined, { email, password: ACCOUNT_PASSWORD, deviceName })
  let pcLogin = await login(PC_NAME)
  if (pcLogin.status !== 200) {
    pcLogin = await api('POST', '/api/auth/register', undefined, {
      email,
      password: ACCOUNT_PASSWORD,
      deviceName: PC_NAME
    })
  }
  const controllerLogin = await login('Controlador de prueba')
  if (typeof pcLogin.data?.token !== 'string' || typeof controllerLogin.data?.token !== 'string') {
    throw new Error(`No se pudo entrar con la cuenta de prueba: ${JSON.stringify([pcLogin, controllerLogin])}`)
  }
  const pcToken: string = pcLogin.data.token
  const controllerToken: string = controllerLogin.data.token

  try {
    await setupHostData(email, pcToken, false)
    startHost()
    let device = await waitDevice(controllerToken, (d) => d.online && d.remote.state === 'available')
    check('la app arrancada oculta registra el PC: en línea y disponible', device?.online === true, device)
    if (!device) return

    ipcMain.handle('api:ice', async () => (await api('GET', '/api/remote/ice-servers', controllerToken)).data.iceServers)
    ipcMain.handle('api:request', (_e, deviceId: string, offer: string) =>
      api('POST', `/api/devices/${deviceId}/remote-requests`, controllerToken, { offer })
    )
    ipcMain.handle('api:outcome', async (_e, id: string) => {
      const deadline = Date.now() + 30_000
      for (;;) {
        const { data } = await api('GET', `/api/remote-requests/${id}`, controllerToken)
        if (data?.status !== 'pending' || Date.now() > deadline) return data
        await sleep(1000)
      }
    })
    ipcMain.handle('pointer:query', () => queryPointer())

    const win = new BrowserWindow({
      width: 960,
      height: 600,
      webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false }
    })
    await win.loadFile(path.join(__dirname, '..', 'controller.html'))
    const scenario = (options: Record<string, unknown>): Promise<any> =>
      win.webContents.executeJavaScript(
        `runScenario(${JSON.stringify({ deviceId: device.id, ...options })})`
      )

    // 1. Contraseña incorrecta: nada de imagen y el PC cierra
    let result = await scenario({ password: 'contraseña-incorrecta' })
    check(
      'contraseña incorrecta: auth-result wrong_password, sin imagen, el PC cierra',
      result.authResult?.reason === 'wrong_password' && result.frames === 0 && result.hostClosed,
      result
    )

    if (args.only === '1,2') {
      result = await scenario({ password: PC_PASSWORD, watchMs: 3000 })
      console.log('ESCENARIO 2', JSON.stringify(result).slice(0, 400))
      return
    }

    // 2. Contraseña correcta: imagen, pantallas, funciones y entrada
    result = await scenario({ password: PC_PASSWORD, keepOpen: true, pointer: true, watchMs: 5000 })
    const primary = screen.getPrimaryDisplay()
    const expected = {
      x: Math.round((primary.bounds.x + primary.bounds.width / 2) * primary.scaleFactor),
      y: Math.round((primary.bounds.y + primary.bounds.height / 2) * primary.scaleFactor)
    }
    check(
      'contraseña correcta: llega la imagen (fps y tamaño) tras hello y auth-result',
      result.authResult?.ok === true && result.frames > 0 && result.fps >= 10,
      result.events ? { fps: result.fps, frames: result.frames, videoSize: result.videoSize, events: result.events } : result
    )
    check(
      'tras autenticar llegan features y displays',
      !!result.events?.includes('features') && !!result.events?.includes('displays'),
      result.events ?? null
    )
    const at = result.pointerAt as { x: number; y: number } | null
    check(
      'el canal pointer mueve el ratón al punto pedido (centro de la pantalla principal)',
      !!at && Math.abs(at.x - expected.x) <= 2 && Math.abs(at.y - expected.y) <= 2,
      { at, expected }
    )
    await sleep(1000)
    check('aviso siempre encima en el PC durante la sesión', windowTitles().includes(NOTICE_TITLE), {
      title: NOTICE_TITLE
    })
    device = await waitDevice(controllerToken, (d) => d.remote.state === 'busy', 10_000)
    check('durante la sesión el PC se publica como busy', device?.remote.state === 'busy', device?.remote)

    // 3. Otra solicitud mientras tanto: ocupado
    const second = await api('POST', `/api/devices/${device.id}/remote-requests`, controllerToken, {
      offer: 'v=0 segunda'
    })
    let outcome: any = null
    for (let i = 0; i < 15 && second.status === 201; i++) {
      outcome = (await api('GET', `/api/remote-requests/${second.data.id}`, controllerToken)).data
      if (outcome?.status !== 'pending') break
      await sleep(1000)
    }
    check('otra solicitud durante la sesión recibe "ocupado"', outcome?.rejection?.reason === 'busy', outcome)

    // 4. "Desconectar" en el aviso: un clic de verdad en su botón (aquí, con la propia entrada remota,
    // porque el PC es este mismo equipo). El aviso mide 420×52, arriba en el centro del área de trabajo
    const area = primary.workArea
    const button = { x: area.x + (area.width - 420) / 2 + 360, y: area.y + 8 + 26 }
    await win.webContents.executeJavaScript(
      `clickAt(${(button.x - primary.bounds.x) / primary.bounds.width}, ${(button.y - primary.bounds.y) / primary.bounds.height})`
    )
    const after = await win.webContents.executeJavaScript('liveState(2500)')
    check(
      '"Desconectar" en el PC corta la sesión: el controlador recibe bye local',
      after?.events?.includes('bye:local') && after?.hostClosed,
      after
    )
    device = await waitDevice(controllerToken, (d) => d.remote.state === 'available', 15_000)
    check('al terminar vuelve a estar disponible', device?.remote.state === 'available', device?.remote)

    // 5. Confirmación local sin respuesta: a los 30 s se rechaza
    await stopHost()
    await setupHostData(email, pcToken, true)
    startHost()
    await waitDevice(controllerToken, (d) => d.online && d.remote.state === 'available')
    const confirmStarted = Date.now()
    result = await scenario({ password: PC_PASSWORD })
    check(
      'confirmación local sin respuesta: auth-result declined a los ~30 s, sin imagen',
      result.authResult?.reason === 'declined' && result.frames === 0,
      { authResult: result.authResult, seconds: Math.round((Date.now() - confirmStarted) / 1000) }
    )
    await stopHost()
    await setupHostData(email, pcToken, false)
    startHost()
    await waitDevice(controllerToken, (d) => d.online && d.remote.state === 'available')

    // 6. Cinco fallos: bloqueo de 15 min, también con la contraseña correcta
    for (let i = 0; i < 5; i++) await scenario({ password: `mala-${i}` })
    result = await scenario({ password: PC_PASSWORD })
    check(
      'tras 5 fallos rechaza con el tiempo restante aunque la contraseña sea correcta',
      result.outcome?.rejection?.reason === 'locked' && result.outcome.rejection.retryAfter > 800,
      result
    )
  } finally {
    await stopHost()
    if (args['delete-account'] === '1') {
      await api('DELETE', '/api/me', pcToken, { password: ACCOUNT_PASSWORD })
    } else {
      // Cierra las dos sesiones de esta ejecución; la cuenta queda para la siguiente
      await api('POST', '/api/auth/logout', pcToken)
      await api('POST', '/api/auth/logout', controllerToken)
    }
  }
}

app.whenReady().then(async () => {
  try {
    await run()
  } catch (error) {
    report.error = String(error instanceof Error ? (error.stack ?? error) : error)
    console.error(error)
  }
  if (args.out) fs.writeFileSync(args.out, JSON.stringify(report, null, 2))
  const failed = report.checks.filter((c) => !c.ok).length
  console.log(`\n${report.checks.length - failed}/${report.checks.length} comprobaciones bien.`)
  app.exit(failed === 0 && !report.error ? 0 : 1)
})

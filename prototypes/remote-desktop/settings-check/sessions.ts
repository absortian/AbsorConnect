// Ajustes con sesiones de verdad (tarea 6.2, lo que `main.ts` no prueba), en un Linux X11 con el
// backend de desarrollo. A es el PC, con su ventana, y B el controlador; las dos se manejan por
// DevTools como una persona:
//   - "Abrir al iniciar sesión" desde Ajustes. A va con su propio HOME, para no escribir en el
//     autostart del usuario real;
//   - el registro: un intento con la contraseña incorrecta (con fecha, hora y equipo), el inicio
//     y el fin de una sesión, y "Alguien está controlando este PC ahora";
//   - desactivar el control remoto durante una sesión;
//   - volver a entrar con la misma cuenta (sigue activado, con la misma contraseña) y con otra
//     (desactivado y sin contraseña);
//   - con XDG_SESSION_TYPE=wayland, el aviso de Wayland y el interruptor desactivado.
//
//   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron prototypes/remote-desktop/settings-check/out/sessions.cjs \
//     --api=http://127.0.0.1:8020 --work=<carpeta temporal> --out=<fichero.json>
import { ChildProcess, spawn } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
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
const CONTROLLER_PORT = 9333
const PC_PORT = 9334
const TEST_EMAIL = 'prueba-control-local@example.test'
/** Otra cuenta, para "Entrar con otra cuenta" (se crea si no existe). */
const OTHER_EMAIL = 'prueba-control-otra@example.test'
const ACCOUNT_PASSWORD = 'contraseña-de-prueba-larga'
const PC_PASSWORD = 'contraseña-del-pc-prueba'
const CONTROLLER_NAME = 'Controlador de prueba'
const PC_NAME = `PC de Ajustes ${new Date().toTimeString().slice(0, 8)}`
const ENABLE = 'Permitir controlar este PC'
const LOGIN = 'Abrir al iniciar sesión'

interface Check {
  name: string
  ok: boolean
  detail: unknown
}
const report: { checks: Check[]; error: string | null } = { checks: [], error: null }
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function check(name: string, ok: boolean, detail: unknown): void {
  report.checks.push({ name, ok, detail })
  console.log(`${ok ? 'OK   ' : 'FALLO'} ${name} ${String(JSON.stringify(detail)).slice(0, 400)}`)
}

// --- API -------------------------------------------------------------------------

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

async function login(deviceName: string, email = TEST_EMAIL): Promise<string> {
  const body = { email, password: ACCOUNT_PASSWORD, deviceName }
  let result = await api('POST', '/api/auth/login', undefined, body)
  if (result.status !== 200) result = await api('POST', '/api/auth/register', undefined, body)
  if (typeof result.data?.token !== 'string') throw new Error(`Sin sesión de prueba: ${JSON.stringify(result)}`)
  return result.data.token
}

let observerToken = ''

interface DeviceEntry {
  name: string
  online: boolean
  remote: { state: string }
}

async function device(name: string, token = observerToken): Promise<DeviceEntry | undefined> {
  const { data } = await api('GET', '/api/devices', token)
  return (data?.devices as DeviceEntry[] | undefined)?.find((d) => d.name === name)
}

async function waitDevice(name: string, ok: (d: DeviceEntry | undefined) => boolean, ms = 20_000): Promise<DeviceEntry | undefined> {
  const deadline = Date.now() + ms
  for (;;) {
    const found = await device(name)
    if (ok(found) || Date.now() > deadline) return found
    await sleep(1000)
  }
}

// --- Las apps --------------------------------------------------------------------

async function preparePc(dir: string, token: string): Promise<void> {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify({ email: TEST_EMAIL, token, encrypted: false }))
  fs.writeFileSync(
    path.join(dir, 'settings.json'),
    JSON.stringify({ theme: 'dark', language: 'es', keepInBackground: false, openAtLogin: false })
  )
  const store = new RemoteAccessStore(path.join(dir, 'remote-access.json'), createPlaintextBox(), PC_NAME)
  await store.bindToAccount(TEST_EMAIL)
  await store.setPassword(PC_PASSWORD)
  await store.setDeviceName(PC_NAME)
  await store.setEnabled(true)
}

const children: ChildProcess[] = []

function launch(dir: string, port: number, env: Record<string, string> = {}, extra: string[] = []): ChildProcess {
  const log = fs.openSync(path.join(dir, 'app.log'), 'a')
  const child = spawn(ELECTRON, [ROOT, `--user-data-dir=${dir}`, `--remote-debugging-port=${port}`, ...extra], {
    env: { ...process.env, ABSOR_CONNECT_API_URL: API, ELECTRON_RUN_AS_NODE: '', ...env },
    stdio: ['ignore', log, log]
  })
  children.push(child)
  return child
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise((resolve) => child.once('exit', resolve))
  child.kill('SIGTERM')
  if ((await Promise.race([exited, sleep(10_000).then(() => 'timeout')])) === 'timeout') child.kill('SIGKILL')
}

async function mainPage(port: number): Promise<Page> {
  const page = await Page.open(await waitTarget(port, (t) => t.url.endsWith('index.html'), 40_000))
  await page.waitFor<boolean>(
    `!!document.querySelector('button[title="Ajustes"]') || !!document.getElementById('auth-email')`,
    (v) => v === true,
    30_000
  )
  return page
}

// --- Ajustes ---------------------------------------------------------------------

const panelText = (ui: Page): Promise<string> => ui.eval<string>(`document.querySelector('.settings-panel')?.innerText ?? ''`)
const toggle = (ui: Page, label: string): Promise<boolean> =>
  ui.eval<boolean>(`(() => { const i = document.querySelector('.settings-panel input[aria-label=${JSON.stringify(label)}]'); if (i) i.click(); return !!i })()`)
/** El interruptor, cuando Ajustes ya ha leído el estado y vale `value`. */
const waitChecked = (ui: Page, label: string, value: boolean): Promise<boolean | null> =>
  ui.waitFor<boolean | null>(`document.querySelector('.settings-panel input[aria-label=${JSON.stringify(label)}]')?.checked ?? null`, (v) => v === value, 10_000)
const disabled = (ui: Page, label: string): Promise<boolean | null> =>
  ui.eval<boolean | null>(`document.querySelector('.settings-panel input[aria-label=${JSON.stringify(label)}]')?.disabled ?? null`)
const clickButton = (ui: Page, prefix: string): Promise<boolean> =>
  ui.eval<boolean>(`(() => { const b = [...document.querySelectorAll('.settings-panel button')].find((b) => b.innerText.trim().startsWith(${JSON.stringify(prefix)})); if (b) b.click(); return !!b })()`)

async function openSettings(ui: Page): Promise<string> {
  await ui.eval(`document.querySelector('.settings-overlay')?.click()`)
  await ui.waitFor<boolean>(`!!document.querySelector('button[title="Ajustes"]')`, (v) => v === true, 30_000)
  await ui.eval(`document.querySelector('button[title="Ajustes"]').click()`)
  return ui.waitFor<string>(`document.querySelector('.settings-panel')?.innerText ?? ''`, (t) => t.includes(ENABLE), 15_000)
}

/** El registro, abierto. */
async function logText(ui: Page, until: (text: string) => boolean, ms = 15_000): Promise<string> {
  // El botón dice "Ver registro (n)" con el registro cerrado y "Ocultar registro" con él abierto
  await clickButton(ui, 'Ver registro')
  return ui.waitFor<string>(`document.querySelector('.settings-panel .remote-log')?.innerText ?? ''`, until, ms)
}

async function typeInto(page: Page, selector: string, text: string): Promise<void> {
  await page.eval(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.focus(); e.select() })()`)
  await page.send('Input.insertText', { text })
}

async function signOut(ui: Page): Promise<boolean> {
  await openSettings(ui)
  const clicked = await ui.eval<boolean>(`(() => { const b = [...document.querySelectorAll('button')].find((b) => b.innerText.includes('Cerrar sesión')); if (b) b.click(); return !!b })()`)
  const auth = await ui.waitFor<boolean>(`!!document.getElementById('auth-email')`, (v) => v === true, 15_000)
  return clicked && auth === true
}

async function signIn(ui: Page, email: string): Promise<boolean> {
  await typeInto(ui, '#auth-email', email)
  await typeInto(ui, '#auth-password', ACCOUNT_PASSWORD)
  await ui.eval(`document.querySelector('form.form-stack').requestSubmit()`)
  return (await ui.waitFor<boolean>(`!!document.querySelector('button[title="Ajustes"]')`, (v) => v === true, 20_000)) === true
}

// --- El controlador ----------------------------------------------------------------

/** Equipos → Conectar. Devuelve la ventana de visor con el formulario de la contraseña. */
async function openViewer(ui: Page): Promise<Page> {
  await ui.eval(`document.querySelector('.settings-overlay')?.click()`)
  await ui.eval(`document.querySelector('button[title="Equipos"]').click()`)
  await ui.waitFor<string>(
    `[...document.querySelectorAll('.settings-row')].find((r) => r.innerText.includes(${JSON.stringify(PC_NAME)}))?.innerText ?? ''`,
    (text) => text.includes('Disponible'),
    40_000
  )
  await ui.eval(`[...document.querySelectorAll('.settings-row')].find((r) => r.innerText.includes(${JSON.stringify(PC_NAME)})).querySelector('button').click()`)
  const viewer = await Page.open(await waitTarget(CONTROLLER_PORT, (t) => t.url.includes('viewer.html')))
  await viewer.waitFor<boolean>(`!!document.getElementById('password')`, (v) => v === true, 15_000)
  return viewer
}

async function submit(viewer: Page, password: string): Promise<void> {
  await viewer.eval(`(() => { document.getElementById('password').value = ${JSON.stringify(password)}; document.getElementById('login').requestSubmit() })()`)
}

const connected = async (viewer: Page): Promise<boolean> =>
  (await viewer.waitFor<boolean>(`document.getElementById('overlay').hidden && document.getElementById('video').videoWidth > 0`, (v) => v === true, 30_000)) === true

const message = (viewer: Page, text: string): Promise<string> =>
  viewer.waitFor<string>(`document.getElementById('overlay').hidden ? '' : document.getElementById('message').textContent`, (t) => t === text, 20_000)

async function closeViewer(viewer: Page): Promise<void> {
  await viewer.eval(`window.close()`).catch(() => undefined)
  viewer.close()
}

// --- Prueba ---------------------------------------------------------------------

async function run(): Promise<void> {
  if (!WORK) throw new Error('Falta --work')
  fs.rmSync(WORK, { recursive: true, force: true })
  observerToken = await login('Observador de prueba')

  // A, con su propio HOME (el autostart de Linux va en ~/.config/autostart)
  const pcDir = path.join(WORK, 'pc')
  const home = path.join(WORK, 'home')
  fs.mkdirSync(home, { recursive: true })
  await preparePc(pcDir, await login(PC_NAME))
  const xauthority = process.env.XAUTHORITY ?? path.join(os.homedir(), '.Xauthority')
  const pc = launch(pcDir, PC_PORT, { HOME: home, XAUTHORITY: xauthority })
  const controllerDir = path.join(WORK, 'controlador')
  fs.mkdirSync(controllerDir, { recursive: true })
  fs.writeFileSync(path.join(controllerDir, 'session.json'), JSON.stringify({ email: TEST_EMAIL, token: await login(CONTROLLER_NAME), encrypted: false }))
  fs.writeFileSync(path.join(controllerDir, 'settings.json'), JSON.stringify({ theme: 'dark', language: 'es' }))
  const controller = launch(controllerDir, CONTROLLER_PORT)
  const pcUi = await mainPage(PC_PORT)
  const ui = await mainPage(CONTROLLER_PORT)
  await waitDevice(PC_NAME, (d) => d?.online === true && d.remote.state === 'available', 40_000)

  // 1. Abrir al iniciar sesión, desde Ajustes
  await openSettings(pcUi)
  const autostart = path.join(home, '.config', 'autostart', 'absor-connect.desktop')
  await toggle(pcUi, LOGIN)
  await sleep(1000)
  const entry = fs.existsSync(autostart) ? fs.readFileSync(autostart, 'utf8') : ''
  const savedOn = JSON.parse(fs.readFileSync(path.join(pcDir, 'settings.json'), 'utf8')).openAtLogin
  check('1. "Abrir al iniciar sesión" escribe el autostart con --hidden y lo guarda', /^Exec=.* --hidden$/m.test(entry) && savedOn === true, { exec: entry.match(/^Exec=.*$/m)?.[0], savedOn })
  await toggle(pcUi, LOGIN)
  await sleep(1000)
  const savedOff = JSON.parse(fs.readFileSync(path.join(pcDir, 'settings.json'), 'utf8')).openAtLogin
  check('1. desactivarla borra el autostart', !fs.existsSync(autostart) && savedOff === false, { exists: fs.existsSync(autostart), savedOff })

  // 2. Registro: un intento con la contraseña incorrecta
  let viewer = await openViewer(ui)
  await submit(viewer, 'contraseña-incorrecta')
  const wrong = await message(viewer, 'Contraseña incorrecta.')
  const failedLog = await logText(pcUi, (t) => t.includes(`Contraseña incorrecta desde ${CONTROLLER_NAME}`))
  const failedLine = failedLog.split('\n').find((l) => l.includes('Contraseña incorrecta')) ?? failedLog
  check('2. el registro muestra el intento fallido con fecha, hora y el equipo', wrong === 'Contraseña incorrecta.' && /\d{1,2}\/\d{1,2}\/\d{4},? \d{1,2}:\d{2}/.test(failedLog) && failedLog.includes(CONTROLLER_NAME), failedLog.slice(0, 200) || failedLine)

  // 3. La sesión: "controlado ahora" e inicio en el registro
  await submit(viewer, PC_PASSWORD)
  const inSession = await connected(viewer)
  const active = await pcUi.waitFor<boolean>(`document.querySelector('.settings-panel')?.innerText.includes('Alguien está controlando este PC ahora.')`, (v) => v === true, 10_000)
  const startLog = await logText(pcUi, (t) => t.includes(`Sesión iniciada desde ${CONTROLLER_NAME}`))
  check('3. durante la sesión, Ajustes dice que alguien controla el PC y el registro tiene el inicio', inSession && active === true && startLog.includes(`Sesión iniciada desde ${CONTROLLER_NAME}`), { inSession, active })

  // 4. Desactivar durante la sesión
  await toggle(pcUi, ENABLE)
  const cut = await message(viewer, 'El PC ha desactivado el control remoto.')
  const endLog = await logText(pcUi, (t) => t.includes(`Sesión con ${CONTROLLER_NAME} terminada`))
  const off = await waitDevice(PC_NAME, (d) => d?.remote.state === 'disabled')
  check('4. desactivarlo durante una sesión la corta, la anota con su duración y se publica', cut === 'El PC ha desactivado el control remoto.' && /terminada \(.+\)/.test(endLog) && off?.remote.state === 'disabled', { cut, end: endLog.split('\n').find((l) => l.includes('terminada')), state: off?.remote.state })
  await closeViewer(viewer)
  await toggle(pcUi, ENABLE)
  await sleep(1000)
  await clickButton(pcUi, 'Ahora no')
  const again = await waitDevice(PC_NAME, (d) => d?.remote.state === 'available')
  check('4. al volver a activarlo (ya tiene contraseña) queda disponible', (await waitChecked(pcUi, ENABLE, true)) === true && again?.remote.state === 'available', again?.remote)

  // 5. Volver a entrar con la misma cuenta: sigue activado y con la misma contraseña
  const sameOut = await signOut(pcUi)
  const sameIn = await signIn(pcUi, TEST_EMAIL)
  const sameText = await openSettings(pcUi)
  const sameEnabled = await waitChecked(pcUi, ENABLE, true)
  viewer = await openViewer(ui)
  await submit(viewer, PC_PASSWORD)
  const sameSession = await connected(viewer)
  check('5. al volver a entrar con la misma cuenta sigue activado y con la misma contraseña', sameOut && sameIn && sameEnabled === true && sameText.includes('Definida') && sameSession, { sameOut, sameIn, sameEnabled, sameSession })
  await viewer.eval(`document.getElementById('disconnect').click()`).catch(() => undefined)
  viewer.close()
  await waitDevice(PC_NAME, (d) => d?.remote.state === 'available')

  // 6. Entrar con otra cuenta: desactivado, sin contraseña, y fuera de la cuenta anterior
  await login('Prueba de otra cuenta', OTHER_EMAIL)
  const otherOut = await signOut(pcUi)
  const otherIn = await signIn(pcUi, OTHER_EMAIL)
  const otherText = await openSettings(pcUi)
  const otherEnabled = await waitChecked(pcUi, ENABLE, false)
  await sleep(3000)
  const inFirst = await device(PC_NAME)
  check('6. al entrar con otra cuenta queda desactivado y sin contraseña, y ya no está en la cuenta anterior', otherOut && otherIn && otherEnabled === false && otherText.includes('Sin definir') && inFirst === undefined, { otherOut, otherIn, otherEnabled, inFirst })

  pcUi.close()
  ui.close()
  await stop(pc)
  await stop(controller)

  // 7. Wayland: el aviso y el interruptor desactivado (la app sigue usando X11 para dibujar)
  const waylandDir = path.join(WORK, 'wayland')
  await preparePc(waylandDir, await login(`${PC_NAME} (Wayland)`))
  const wayland = launch(waylandDir, PC_PORT, { XDG_SESSION_TYPE: 'wayland' }, ['--ozone-platform=x11'])
  const waylandUi = await mainPage(PC_PORT)
  const waylandText = await openSettings(waylandUi)
  const waylandDisabled = await disabled(waylandUi, ENABLE)
  const published = await waitDevice(PC_NAME, (d) => d?.remote.state === 'unsupported')
  check('7. con Wayland, Ajustes lo explica, sugiere X11 y el interruptor está desactivado', waylandText.includes('usa Wayland') && waylandText.includes('sesión X11') && waylandDisabled === true, { waylandDisabled })
  check('7. con Wayland, el PC aparece en la cuenta como no compatible', published?.remote.state === 'unsupported', published?.remote)
  waylandUi.close()
  await stop(wayland)
}

run()
  .catch((error) => {
    report.error = String(error instanceof Error ? (error.stack ?? error) : error)
    console.error(error)
  })
  .finally(async () => {
    for (const child of children) await stop(child)
    if (args.out) fs.writeFileSync(args.out, JSON.stringify(report, null, 2))
    const failed = report.checks.filter((c) => !c.ok).length
    console.log(`\n${report.checks.length - failed}/${report.checks.length} comprobaciones bien.`)
    process.exit(failed === 0 && !report.error ? 0 : 1)
  })

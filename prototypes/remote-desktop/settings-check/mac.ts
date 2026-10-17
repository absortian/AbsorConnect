// Ajustes en macOS (tarea 6.2): la sección "Control remoto de este PC" de la app de verdad, con el
// backend de desarrollo de otro equipo. La lanza `test-mac.sh`, con Node:
//   - muestra los permisos de Grabación de pantalla y Accesibilidad, los límites de macOS y no el
//     aviso de Wayland ni la pista del cortafuegos de Windows;
//   - lo que dice de los permisos coincide con lo que publica en la cuenta ("faltan permisos" o
//     disponible) y, según la persona delante del Mac, con Ajustes del Sistema;
//   - cada "Abrir Ajustes del Sistema" abre su panel.
// Deja una captura de la sección junto al JSON.
import { ChildProcess, execFile, spawn } from 'child_process'
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
const API = (args.api ?? '').replace(/\/+$/, '')
const ROOT = path.resolve(__dirname, '..', '..', '..', '..')
const WORK = path.join(os.tmpdir(), 'absor-settings-mac')
const PORT = 9336
const TEST_EMAIL = 'prueba-control-local@example.test'
const ACCOUNT_PASSWORD = 'contraseña-de-prueba-larga'
const PC_NAME = `Mac de Ajustes ${new Date().toTimeString().slice(0, 8)}`
const OUT = args.out ?? path.join(os.homedir(), 'Downloads', 'absor-settings-check-macos.json')
const SCREENSHOT = OUT.replace(/\.json$/, '.png')

interface Check {
  name: string
  ok: boolean
  detail: unknown
}
const report: { macos: string; checks: Check[]; error: string | null } = { macos: args.macos ?? '', checks: [], error: null }
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function check(name: string, ok: boolean, detail: unknown): void {
  report.checks.push({ name, ok, detail })
  console.log(`${ok ? 'OK   ' : 'FALLO'} ${name} ${String(JSON.stringify(detail)).slice(0, 300)}`)
}

function osascript(script: string, timeout = 120_000): Promise<string> {
  return new Promise((resolve) =>
    execFile('osascript', ['-e', script], { timeout, encoding: 'utf8' }, (error, stdout, stderr) =>
      resolve(error ? `ERROR ${(stderr.trim() || error.message).slice(-200)}` : stdout.trim())
    )
  )
}

/** Pregunta a la persona delante del Mac (diálogo del sistema). */
async function ask(question: string): Promise<boolean> {
  const answer = await osascript(
    `display dialog ${JSON.stringify(question)} with title "Prueba de Ajustes" buttons {"No", "Sí"} default button "Sí"`
  )
  return answer.includes('Sí')
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
  const body = { email: TEST_EMAIL, password: ACCOUNT_PASSWORD, deviceName }
  let result = await api('POST', '/api/auth/login', undefined, body)
  if (result.status !== 200) result = await api('POST', '/api/auth/register', undefined, body)
  if (typeof result.data?.token !== 'string') throw new Error(`Sin sesión de prueba: ${JSON.stringify(result)}`)
  return result.data.token
}

let app: ChildProcess | null = null

async function run(): Promise<void> {
  if (!API) throw new Error('Falta --api=http://<ip del otro equipo>:8020')
  fs.rmSync(WORK, { recursive: true, force: true })
  fs.mkdirSync(WORK, { recursive: true })
  const observer = await login('Observador de prueba')
  fs.writeFileSync(path.join(WORK, 'session.json'), JSON.stringify({ email: TEST_EMAIL, token: await login(PC_NAME), encrypted: false }))
  fs.writeFileSync(path.join(WORK, 'settings.json'), JSON.stringify({ theme: 'dark', language: 'es', keepInBackground: false, openAtLogin: false }))
  const store = new RemoteAccessStore(path.join(WORK, 'remote-access.json'), createPlaintextBox(), PC_NAME)
  await store.bindToAccount(TEST_EMAIL)
  await store.setPassword('contraseña-del-pc-prueba')
  await store.setDeviceName(PC_NAME)
  await store.setEnabled(true)

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const electron = require(path.join(ROOT, 'node_modules', 'electron')) as string
  const log = fs.openSync(path.join(WORK, 'app.log'), 'a')
  app = spawn(electron, [ROOT, `--user-data-dir=${WORK}`, `--remote-debugging-port=${PORT}`], {
    env: { ...process.env, ABSOR_CONNECT_API_URL: API, ELECTRON_RUN_AS_NODE: '' },
    stdio: ['ignore', log, log]
  })
  const ui = await Page.open(await waitTarget(PORT, (t) => t.url.endsWith('index.html'), 60_000))
  await ui.waitFor<boolean>(`!!document.querySelector('button[title="Ajustes"]')`, (v) => v === true, 30_000)
  await ui.eval(`document.querySelector('button[title="Ajustes"]').click()`)
  const text = await ui.waitFor<string>(`document.querySelector('.settings-panel')?.innerText ?? ''`, (t) => t.includes('Permisos de macOS') && /Concedido|Falta/.test(t), 15_000)

  // Lo que muestra
  const permissions = await ui.eval<Record<string, string>>(`Object.fromEntries([...document.querySelectorAll('.settings-panel .settings-row')]
    .filter((r) => r.querySelector('.permission-missing, .permission-granted'))
    .map((r) => [r.querySelector('.settings-row-label').innerText, r.querySelector('.permission-missing') ? 'Falta' : 'Concedido']))`)
  // Desde macOS 27, Accesibilidad se llama "Control de dispositivos y acceso a datos"
  const renamed = Number(report.macos.split('.')[0]) >= 27
  const accessibilityLabel = renamed ? 'Control de dispositivos y acceso a datos' : 'Accesibilidad'
  check('Ajustes muestra los dos permisos de macOS, con el nombre de esta versión y su estado', Object.keys(permissions).length === 2 && 'Grabación de pantalla' in permissions && accessibilityLabel in permissions, permissions)
  check('Ajustes explica los límites de macOS y no muestra el aviso de Wayland ni la pista de Windows', text.includes('Desde macOS 15') && !text.includes('Wayland') && !text.includes('Windows puede preguntar'), null)

  // Lo que publica la cuenta, coherente con lo que muestra
  const missing = Object.values(permissions).includes('Falta')
  const expected = missing ? 'missing_permissions' : 'available'
  let published = ''
  for (let i = 0; i < 20 && published !== expected; i++) {
    const { data } = await api('GET', '/api/devices', observer)
    published = data?.devices?.find((d: any) => d.name === PC_NAME)?.remote?.state ?? ''
    if (published !== expected) await sleep(1000)
  }
  check(`la cuenta publica el PC como ${expected}, como dice Ajustes`, published === expected, { published, permissions })

  // Captura de la sección, para revisarla a ojo
  await ui.eval(`[...document.querySelectorAll('.settings-panel h3')].find((h) => h.innerText.toLowerCase().includes('control remoto')).scrollIntoView()`)
  await ui.eval(`[...document.querySelectorAll('.settings-panel *')].find((e) => e.innerText === 'Permisos de macOS')?.scrollIntoView({ block: 'center' })`)
  await sleep(400)
  fs.writeFileSync(SCREENSHOT, await ui.screenshot())

  const summary = Object.entries(permissions).map(([k, v]) => `${k}: ${v}`).join(' · ')
  const matches = await ask(`Ajustes de la app dice: ${summary}.\n\n¿Coincide con lo que tiene Terminal (o la app desde la que lanzaste la prueba) en Ajustes del Sistema > Privacidad y seguridad?`)
  check('lo que dice Ajustes coincide con Ajustes del Sistema (según la persona delante del Mac)', matches, summary)

  // Cada botón abre su panel, y el panel se llama como lo nombra Ajustes de la app
  for (const label of ['Grabación de pantalla', accessibilityLabel]) {
    await osascript('tell application "System Settings" to quit')
    await sleep(1500)
    await ui.eval(`[...document.querySelectorAll('.settings-panel .settings-row')].find((r) => r.querySelector('.settings-row-label')?.innerText === ${JSON.stringify(label)}).querySelector('button').click()`)
    let title = ''
    for (let i = 0; i < 16 && !title.includes(label); i++) {
      await sleep(500)
      title = await osascript('tell application "System Events" to tell process "System Settings" to get name of front window', 10_000)
    }
    check(`"Abrir Ajustes del Sistema" de ${label} abre el panel con ese nombre`, title.includes(label), title)
  }
  await osascript('tell application "System Settings" to quit')
  ui.close()
}

run()
  .catch((error) => {
    report.error = String(error instanceof Error ? (error.stack ?? error) : error)
    console.error(error)
  })
  .finally(async () => {
    if (app && app.exitCode === null) {
      const exited = new Promise((resolve) => app!.once('exit', resolve))
      app.kill('SIGTERM')
      await Promise.race([exited, sleep(10_000)])
    }
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2))
    const failed = report.checks.filter((c) => !c.ok).length
    console.log(`\n${report.checks.length - failed}/${report.checks.length} comprobaciones bien.`)
    process.exit(failed === 0 && !report.error ? 0 : 1)
  })

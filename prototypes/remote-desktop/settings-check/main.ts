// Prueba de Ajustes (tarea 6.2): la app de verdad con una cuenta de prueba, manejada por DevTools como
// una persona: Segundo plano y Control remoto de este PC (contraseña, activar, nombre, funciones,
// desactivar), comprobando en la API lo que publica el PC. No toca "Abrir al iniciar sesión" (en
// Linux escribiría en ~/.config/autostart del usuario real).
//
//   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron prototypes/remote-desktop/settings-check/out/main.cjs \
//     --api=http://127.0.0.1:8020 --work=<carpeta temporal> --out=<fichero.json> [--screenshot=<png>]
import { ChildProcess, spawn } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { Page, waitTarget } from '../lib/cdp'

const args = Object.fromEntries(
  process.argv
    .filter((a) => a.startsWith('--') && a.includes('='))
    .map((a) => [a.slice(2, a.indexOf('=')), a.slice(a.indexOf('=') + 1)])
)
const API = (args.api ?? 'http://127.0.0.1:8020').replace(/\/+$/, '')
const ROOT = path.resolve(__dirname, '..', '..', '..', '..')
const WORK = args.work
const PORT = 9335
const TEST_EMAIL = 'prueba-control-local@example.test'
const ACCOUNT_PASSWORD = 'contraseña-de-prueba-larga'
const NAME = `Sobremesa ${new Date().toTimeString().slice(0, 8)}`

const report: { checks: { name: string; ok: boolean; detail: unknown }[]; error: string | null } = {
  checks: [],
  error: null
}
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function check(name: string, ok: boolean, detail: unknown): void {
  report.checks.push({ name, ok, detail })
  console.log(`${ok ? 'OK   ' : 'FALLO'} ${name} ${String(JSON.stringify(detail)).slice(0, 300)}`)
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

let app: ChildProcess | null = null

/** El equipo de esta app tal como lo ve la cuenta, cuando cumple `ok`. */
async function published(token: string, ok: (d: any) => boolean, ms = 20_000): Promise<any> {
  const deadline = Date.now() + ms
  let last: any = null
  while (Date.now() < deadline) {
    const { data } = await api('GET', '/api/devices', token)
    last = data?.devices?.filter((d: any) => d.online) ?? last
    const match = data?.devices?.find((d: any) => ok(d))
    if (match) return match
    await sleep(1000)
  }
  return last
}

async function run(): Promise<void> {
  if (!WORK) throw new Error('Falta --work')
  fs.rmSync(WORK, { recursive: true, force: true })
  fs.mkdirSync(WORK, { recursive: true })
  const token = await login('Ajustes de prueba')
  const observer = await login('Observador de prueba')
  fs.writeFileSync(path.join(WORK, 'session.json'), JSON.stringify({ email: TEST_EMAIL, token, encrypted: false }))
  fs.writeFileSync(
    path.join(WORK, 'settings.json'),
    JSON.stringify({ theme: 'dark', language: 'es', keepInBackground: false, openAtLogin: false })
  )
  const log = fs.openSync(path.join(WORK, 'app.log'), 'a')
  app = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron'), [ROOT, `--user-data-dir=${WORK}`, `--remote-debugging-port=${PORT}`], {
    env: { ...process.env, ABSOR_CONNECT_API_URL: API, ELECTRON_RUN_AS_NODE: '' },
    stdio: ['ignore', log, log]
  })

  const ui = await Page.open(await waitTarget(PORT, (t) => t.url.endsWith('index.html')))
  const panelText = (): Promise<string> => ui.eval(`document.querySelector('.settings-panel')?.innerText ?? ''`)
  const clickButton = (text: string): Promise<boolean> =>
    ui.eval(`(() => { const b = [...document.querySelectorAll('.settings-panel button')].find((b) => b.innerText.trim() === ${JSON.stringify(text)}); if (b) b.click(); return !!b })()`)
  const toggle = (label: string): Promise<boolean> =>
    ui.eval(`(() => { const i = document.querySelector('.settings-panel input[aria-label=${JSON.stringify(label)}]'); if (i) i.click(); return !!i })()`)
  const checked = (label: string): Promise<boolean> =>
    ui.eval(`document.querySelector('.settings-panel input[aria-label=${JSON.stringify(label)}]')?.checked ?? null`)
  const setInput = (selector: string, value: string): Promise<unknown> =>
    ui.eval(`(() => {
      const input = document.querySelector(${JSON.stringify(selector)})
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, ${JSON.stringify(value)})
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })()`)
  const submitPassword = async (password: string, confirmation: string): Promise<string> => {
    await setInput('#remote-password', password)
    await setInput('#remote-password-confirmation', confirmation)
    await ui.eval(`document.querySelector('#remote-password').closest('form').requestSubmit()`)
    await sleep(800)
    return ui.eval(`document.querySelector('.settings-panel .form-error')?.innerText ?? ''`)
  }

  await ui.waitFor<boolean>(`!!document.querySelector('button[title="Ajustes"]')`, (v) => v === true)
  await ui.eval(`document.querySelector('button[title="Ajustes"]').click()`)
  const text = await ui.waitFor<string>(`document.querySelector('.settings-panel')?.innerText ?? ''`, (t) => t.includes('Permitir controlar este PC'))
  check('Ajustes tiene las secciones Segundo plano y Control remoto de este PC', text.includes('SEGUNDO PLANO') || text.includes('Segundo plano'), text.slice(0, 200))
  check('en Linux X11 explica qué no se puede controlar y no muestra permisos de macOS', text.includes('Solo funciona con sesión X11') && !text.includes('Permisos de macOS'), null)
  check('sin contraseña el control remoto está desactivado', (await checked('Permitir controlar este PC')) === false && text.includes('Sin definir'), null)

  // Activar sin contraseña: primero hay que crearla
  await toggle('Permitir controlar este PC')
  const form = await ui.waitFor<boolean>(`!!document.querySelector('#remote-password')`, (v) => v === true, 5000)
  check('activar sin contraseña pide crearla', form, form)
  const short = await submitPassword('corta', 'corta')
  check('contraseña de menos de 8 caracteres: error', short.includes('al menos 8'), short)
  const mismatch = await submitPassword('contraseña-larga-1', 'contraseña-larga-2')
  check('contraseñas distintas: error', mismatch.includes('no coinciden'), mismatch)
  await submitPassword('contraseña-del-pc-1', 'contraseña-del-pc-1')
  const enabled = await ui.waitFor<boolean>(`document.querySelector('.settings-panel input[aria-label="Permitir controlar este PC"]')?.checked`, (v) => v === true, 10_000)
  const afterEnable = await panelText()
  check('con la contraseña creada queda activado', enabled === true && afterEnable.includes('Definida'), null)
  check('propone activar el segundo plano', afterEnable.includes('Activarlas'), null)
  await clickButton('Ahora no')

  // Lo que publica la cuenta: disponible, con el nombre por defecto (el del sistema)
  let device = await published(observer, (d) => d.online && d.remote.state === 'available')
  check('el PC aparece disponible en la cuenta', device?.remote?.state === 'available' && device?.online === true, device)

  // Nombre y funciones
  await ui.eval(`document.querySelector('.settings-panel input[aria-label="Nombre del PC"]').focus()`)
  await setInput('.settings-panel input[aria-label="Nombre del PC"]', NAME)
  await ui.eval(`document.querySelector('.settings-panel input[aria-label="Nombre del PC"]').blur()`)
  // Sin esperar a que se guarde el nombre: Ajustes refresca y escribe a la vez, y nada se pierde
  await toggle('Enviar y descargar ficheros')
  const filesSwitch = await ui.waitFor<boolean>(`document.querySelector('.settings-panel input[aria-label="Enviar y descargar ficheros"]')?.checked`, (v) => v === false, 5000)
  device = await published(observer, (d) => d.name === NAME && d.remote.features.files === false)
  const nameField = await ui.eval<string>(`document.querySelector('.settings-panel input[aria-label="Nombre del PC"]').value`)
  check('cambiar el nombre y quitar los ficheros se publica en la cuenta', filesSwitch === false && device?.name === NAME && device?.remote?.features?.files === false, { device, nameField, filesSwitch })

  // Segundo plano: "Mantener abierta" se guarda (sin tocar "Abrir al iniciar sesión")
  await toggle('Mantener abierta en segundo plano')
  await sleep(500)
  const saved = JSON.parse(fs.readFileSync(path.join(WORK, 'settings.json'), 'utf8'))
  check('"Mantener abierta en segundo plano" se guarda', saved.keepInBackground === true && saved.openAtLogin === false, saved)

  if (args.screenshot) {
    // La sección del control remoto, desde su título
    await ui.eval(`[...document.querySelectorAll('.settings-panel h3')].find((h) => h.innerText.toLowerCase().includes('control remoto')).scrollIntoView()`)
    await sleep(300)
    fs.writeFileSync(args.screenshot, await ui.screenshot())
    await ui.eval(`document.querySelector('.settings-panel').scrollBy(0, 420)`)
    await sleep(300)
    fs.writeFileSync(args.screenshot.replace(/\.png$/, '-2.png'), await ui.screenshot())
  }

  // Cambiar la contraseña y ver el registro (vacío)
  await clickButton('Cambiar contraseña del PC')
  await ui.waitFor<boolean>(`!!document.querySelector('#remote-password')`, (v) => v === true, 5000)
  const changeError = await submitPassword('contraseña-del-pc-2', 'contraseña-del-pc-2')
  check('cambiar la contraseña funciona', changeError === '' && !(await ui.eval<boolean>(`!!document.querySelector('#remote-password')`)), changeError)
  await clickButton('Ver registro (0)')
  check('el registro se muestra (vacío)', (await panelText()).includes('Todavía no hay sesiones'), null)

  // Desactivar
  await toggle('Permitir controlar este PC')
  device = await published(observer, (d) => d.name === NAME && d.remote.state === 'disabled')
  check('desactivar se publica en la cuenta', device?.remote?.state === 'disabled', device?.remote)
  ui.close()
}

run()
  .catch((error) => {
    report.error = String(error instanceof Error ? (error.stack ?? error) : error)
    console.error(error)
  })
  .finally(async () => {
    // Se espera a que la app termine de verdad: la siguiente prueba usa la misma carpeta y puerto
    if (app && app.exitCode === null) {
      const started = Date.now()
      const exited = new Promise((resolve) => app!.once('exit', resolve))
      app.kill('SIGTERM')
      if ((await Promise.race([exited, sleep(10_000).then(() => 'timeout')])) === 'timeout') {
        console.log('La app no se cierra en 10 s: SIGKILL')
        app.kill('SIGKILL')
        await exited
      } else console.log(`La app se cierra en ${Date.now() - started} ms`)
    }
    if (args.out) fs.writeFileSync(args.out, JSON.stringify(report, null, 2))
    const failed = report.checks.filter((c) => !c.ok).length
    console.log(`\n${report.checks.length - failed}/${report.checks.length} comprobaciones bien.`)
    process.exit(failed === 0 && !report.error ? 0 : 1)
  })

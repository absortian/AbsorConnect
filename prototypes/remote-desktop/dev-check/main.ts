// Prueba de las tres páginas y sus preloads (tareas 5.1 y 6.1) en un Linux X11 con el backend de
// desarrollo: A es la app en modo desarrollo (`electron-vite dev`, lo que hace `npm run dev`) y
// hace de PC; B es la app compilada (`out/`) y hace de controlador. Las dos se manejan por
// DevTools. Comprueba que:
//   - `npm run build` deja las tres páginas y los tres preloads;
//   - en desarrollo, las tres páginas (principal, `host` y visor) salen del servidor de Vite;
//   - cada ventana tiene solo su propio puente (`api`, `absorHost` o `absorViewer`), y las
//     ventanas `host` y de visor, con sandbox, ni `require` ni `process`.
//
// Se ejecuta con Electron como Node, después de `electron-vite build`:
//
//   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron prototypes/remote-desktop/dev-check/out/main.cjs \
//     --api=http://127.0.0.1:8020 --work=<carpeta temporal> --out=<fichero.json>
//
// `electron-vite dev` vuelve a compilar el proceso principal y los preloads en `out/` (en modo
// desarrollo); conviene repetir `electron-vite build` después.
import { ChildProcess, spawn } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { Page, Target, targets, waitTarget } from '../lib/cdp'
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
const DEV_SERVER = 'http://localhost:5173'
const CONTROLLER_PORT = 9333
const PC_PORT = 9334
const TEST_EMAIL = 'prueba-control-local@example.test'
const ACCOUNT_PASSWORD = 'contraseña-de-prueba-larga'
const PC_PASSWORD = 'contraseña-del-pc-prueba'
const PC_NAME = `PC de desarrollo ${new Date().toTimeString().slice(0, 8)}`

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
  fs.writeFileSync(
    path.join(dir, 'settings.json'),
    JSON.stringify({ theme: 'dark', language: 'es', keepInBackground: false, openAtLogin: false })
  )
}

const children: ChildProcess[] = []

/** A: `electron-vite dev`, con Electron como Node para la herramienta y sin él para la app. */
function launchDev(dir: string): ChildProcess {
  // electron-vite lanza la app con su mismo entorno: el envoltorio quita ELECTRON_RUN_AS_NODE
  const wrapper = path.join(WORK, 'electron-dev.sh')
  fs.writeFileSync(wrapper, `#!/bin/sh\nunset ELECTRON_RUN_AS_NODE\nexec "${ELECTRON}" "$@"\n`)
  fs.chmodSync(wrapper, 0o755)
  const log = fs.openSync(path.join(dir, 'dev.log'), 'a')
  // Los argumentos de la app van detrás de `--` (como `npm run dev -- …`): electron-vite pisa
  // ELECTRON_CLI_ARGS con lo que haya ahí
  const cli = path.join(ROOT, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js')
  const appArgs = [`--user-data-dir=${dir}`, `--remote-debugging-port=${PC_PORT}`]
  const child = spawn(ELECTRON, [cli, 'dev', '--', ...appArgs], {
    cwd: ROOT,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ELECTRON_EXEC_PATH: wrapper, ABSOR_CONNECT_API_URL: API },
    stdio: ['ignore', log, log],
    detached: true
  })
  children.push(child)
  return child
}

/** B: la app compilada. */
function launchBuilt(dir: string): ChildProcess {
  const log = fs.openSync(path.join(dir, 'app.log'), 'a')
  const child = spawn(ELECTRON, [ROOT, `--user-data-dir=${dir}`, `--remote-debugging-port=${CONTROLLER_PORT}`], {
    env: { ...process.env, ABSOR_CONNECT_API_URL: API, ELECTRON_RUN_AS_NODE: '', ELECTRON_RENDERER_URL: '' },
    stdio: ['ignore', log, log]
  })
  children.push(child)
  return child
}

/** Procesos principales de las apps de la prueba (los que llevan su --user-data-dir). */
function appMainProcesses(): number[] {
  const found: number[] = []
  for (const name of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue
    try {
      const argv = fs.readFileSync(`/proc/${name}/cmdline`, 'utf8').split('\0')
      if (argv.some((a) => a.startsWith(`--user-data-dir=${WORK}`)) && !argv.some((a) => a.startsWith('--type='))) {
        found.push(Number(name))
      }
    } catch {
      // Ya terminó
    }
  }
  return found
}

const isMain = (t: Target): boolean => !t.url.includes('host.html') && !t.url.includes('viewer.html') && t.url !== 'about:blank'

/** Qué puentes ve una página (y si tiene `require` o `process`, que con sandbox no debe tener). */
interface Bridges {
  api: string
  absorHost: string
  absorViewer: string
  require: string
  process: string
  keys: string[]
}
const bridgesOf = (page: Page, own: string): Promise<Bridges> =>
  page.eval<Bridges>(`({
    api: typeof window.api, absorHost: typeof window.absorHost, absorViewer: typeof window.absorViewer,
    require: typeof require, process: typeof process,
    keys: Object.keys(window[${JSON.stringify(own)}] ?? {}).sort()
  })`)

function onlyOwn(bridges: Bridges, own: 'api' | 'absorHost' | 'absorViewer', sandboxed: boolean): boolean {
  const names = ['api', 'absorHost', 'absorViewer'] as const
  return (
    names.every((name) => (bridges[name] === 'object') === (name === own)) &&
    bridges.keys.length > 0 &&
    (!sandboxed || (bridges.require === 'undefined' && bridges.process === 'undefined'))
  )
}

async function run(): Promise<void> {
  if (!WORK) throw new Error('Falta --work')
  fs.rmSync(WORK, { recursive: true, force: true })
  fs.mkdirSync(WORK, { recursive: true })

  // 6.1: lo que deja `npm run build` (antes de que electron-vite dev recompile out/)
  const built = {
    renderer: ['index.html', 'host.html', 'viewer.html'].filter((f) => fs.existsSync(path.join(ROOT, 'out', 'renderer', f))),
    preload: ['index.js', 'host.js', 'viewer.js'].filter((f) => fs.existsSync(path.join(ROOT, 'out', 'preload', f)))
  }
  check('6.1 la compilación deja las tres páginas y los tres preloads', built.renderer.length === 3 && built.preload.length === 3, built)

  // A: el PC, en modo desarrollo
  const pcDir = path.join(WORK, 'pc')
  writeSession(pcDir, await login(PC_NAME))
  const store = new RemoteAccessStore(path.join(pcDir, 'remote-access.json'), createPlaintextBox(), PC_NAME)
  await store.bindToAccount(TEST_EMAIL)
  await store.setPassword(PC_PASSWORD)
  await store.setDeviceName(PC_NAME)
  await store.setEnabled(true)
  launchDev(pcDir)
  const pcMainTarget = await waitTarget(PC_PORT, isMain, 120_000)
  const pcMain = await Page.open(pcMainTarget)
  check('6.1 con `npm run dev`, la ventana principal sale del servidor de Vite', pcMainTarget.url.startsWith(DEV_SERVER), pcMainTarget.url)

  const served: Record<string, number | string> = {}
  for (const page of ['host.html', 'viewer.html']) {
    const response = await fetch(`${DEV_SERVER}/${page}`).catch((error: unknown) => String(error))
    served[page] = typeof response === 'string' ? response : response.status
  }
  check('6.1 el servidor de Vite sirve host.html y viewer.html', served['host.html'] === 200 && served['viewer.html'] === 200, served)

  await pcMain.waitFor<boolean>(`!!document.querySelector('button[title="Ajustes"]')`, (v) => v === true, 30_000)
  const pcBridges = await bridgesOf(pcMain, 'api')
  check('5.1 la ventana principal solo tiene window.api', onlyOwn(pcBridges, 'api', false), { ...pcBridges, keys: pcBridges.keys.length })

  // Un visor abierto en desarrollo también sale del servidor de Vite
  await pcMain.eval(`window.api.openViewer('00000000-0000-4000-8000-000000000000', 'Visor de prueba')`)
  const devViewerTarget = await waitTarget(PC_PORT, (t) => t.url.includes('viewer.html'), 20_000)
  check('6.1 en desarrollo, el visor sale del servidor de Vite', devViewerTarget.url.startsWith(DEV_SERVER), devViewerTarget.url)
  const devViewer = await Page.open(devViewerTarget)
  await devViewer.eval('window.close()').catch(() => undefined)
  devViewer.close()

  // B: el controlador (compilado) se conecta a A
  const controllerDir = path.join(WORK, 'controlador')
  writeSession(controllerDir, await login('Controlador de prueba'))
  launchBuilt(controllerDir)
  const ui = await Page.open(await waitTarget(CONTROLLER_PORT, (t) => t.url.endsWith('index.html'), 40_000))
  await ui.waitFor<boolean>(`!!document.querySelector('button[title="Equipos"]')`, (v) => v === true, 30_000)
  const uiBridges = await bridgesOf(ui, 'api')
  check('5.1 la ventana principal de B solo tiene window.api', onlyOwn(uiBridges, 'api', false), { ...uiBridges, keys: uiBridges.keys.length })

  await ui.eval(`document.querySelector('button[title="Equipos"]').click()`)
  await ui.waitFor<string>(
    `[...document.querySelectorAll('.settings-row')].find((r) => r.innerText.includes(${JSON.stringify(PC_NAME)}))?.innerText ?? ''`,
    (text) => text.includes('Disponible'),
    40_000
  )
  await ui.eval(`[...document.querySelectorAll('.settings-row')].find((r) => r.innerText.includes(${JSON.stringify(PC_NAME)})).querySelector('button').click()`)
  const viewer = await Page.open(await waitTarget(CONTROLLER_PORT, (t) => t.url.includes('viewer.html')))
  await viewer.waitFor<boolean>(`!!document.getElementById('password')`, (v) => v === true, 15_000)
  const viewerBridges = await bridgesOf(viewer, 'absorViewer')
  check('5.1 el visor solo tiene window.absorViewer, sin require ni process', onlyOwn(viewerBridges, 'absorViewer', true), viewerBridges)

  await viewer.eval(`(() => { document.getElementById('password').value = ${JSON.stringify(PC_PASSWORD)}; document.getElementById('login').requestSubmit() })()`)
  const connected = await viewer.waitFor<boolean>(`document.getElementById('overlay').hidden && document.getElementById('video').videoWidth > 0`, (v) => v === true, 30_000)
  check('B controla A (en desarrollo)', connected === true, connected)

  const hostTarget = (await targets(PC_PORT)).find((t) => t.type === 'page' && t.url.includes('host.html'))
  check('6.1 en desarrollo, la ventana host sale del servidor de Vite', !!hostTarget?.url.startsWith(DEV_SERVER), hostTarget?.url ?? 'sin ventana host')
  if (hostTarget) {
    const host = await Page.open(hostTarget)
    const hostBridges = await bridgesOf(host, 'absorHost')
    check('5.1 la ventana host solo tiene window.absorHost, sin require ni process', onlyOwn(hostBridges, 'absorHost', true), hostBridges)
    host.close()
  }

  await viewer.eval(`document.getElementById('disconnect').click()`).catch(() => undefined)
  viewer.close()
  ui.close()
  pcMain.close()
}

run()
  .catch((error) => {
    report.error = String(error instanceof Error ? (error.stack ?? error) : error)
    console.error(error)
  })
  .finally(async () => {
    // Primero el proceso principal de cada app, que cierra los suyos: si la señal llega a la vez a
    // todo el grupo, los hijos mueren antes y el principal de A se queda colgado
    for (const pid of appMainProcesses()) process.kill(pid, 'SIGTERM')
    await sleep(3000)
    for (const child of children) {
      try {
        // electron-vite va en su propio grupo de procesos
        if (child.pid) process.kill(-child.pid, 'SIGTERM')
      } catch {
        child.kill('SIGTERM')
      }
    }
    await sleep(1000)
    for (const pid of appMainProcesses()) process.kill(pid, 'SIGKILL')
    if (args.out) fs.writeFileSync(args.out, JSON.stringify(report, null, 2))
    const failed = report.checks.filter((c) => !c.ok).length
    console.log(`\n${report.checks.length - failed}/${report.checks.length} comprobaciones bien.`)
    process.exit(failed === 0 && !report.error ? 0 : 1)
  })

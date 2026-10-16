// Abre una sesión desde este equipo con un PC de prueba de la cuenta y la mantiene un rato, para
// comprobar a mano (o con otra herramienta) lo que se ve en el PC durante una sesión: la bandeja, el
// aviso, las notificaciones. Se ejecuta con Electron:
//
//   node_modules/electron/dist/electron prototypes/remote-desktop/lan-check/out/hold-session.cjs \
//     --api=http://<ip del backend>:8020 --work=<carpeta temporal> --pc="PC de prueba Windows" \
//     [--seconds=60] [--out=<fichero.json>]
//
// El PC tiene que estar preparado con prepare-pc.ts (misma contraseña de pruebas).
import { app as electronApp } from 'electron'
import { ChildProcess, spawn } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { Page, waitTarget } from '../lib/cdp'
import { API, api, args, createReport, describeError, login, PC_PASSWORD, sleep, systemName, TEST_EMAIL } from './common'

const ROOT = path.resolve(__dirname, '..', '..', '..', '..')
const ELECTRON =
  process.platform === 'darwin'
    ? path.join(ROOT, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron')
    : path.join(ROOT, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron')
const DEBUG_PORT = 9338
const CONTROLLER_NAME = `Controlador ${systemName()} de prueba`
const { report, check } = createReport('hold-session')
let child: ChildProcess | null = null

async function run(): Promise<void> {
  const work = args.work
  const pcName = args.pc
  const seconds = Number(args.seconds ?? 60)
  if (!work || !pcName) throw new Error('Faltan --work y --pc')
  const data = path.join(work, 'controlador')
  fs.rmSync(work, { recursive: true, force: true })
  fs.mkdirSync(data, { recursive: true })
  const token = await login(CONTROLLER_NAME)

  // El PC tiene que estar en la cuenta y disponible
  let device: any = null
  for (let i = 0; i < 60 && !device; i++) {
    const { data: list } = await api('GET', '/api/devices', token)
    device = (list?.devices ?? []).find((d: any) => d.name === pcName && d.online && d.remote?.state === 'available')
    if (!device) await sleep(2000)
  }
  if (!device) throw new Error(`«${pcName}» no aparece disponible en la cuenta`)

  fs.writeFileSync(path.join(data, 'session.json'), JSON.stringify({ email: TEST_EMAIL, token, encrypted: false }))
  fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({ theme: 'dark', language: 'es', keepInBackground: false, openAtLogin: false }))
  const env: NodeJS.ProcessEnv = { ...process.env, ABSOR_CONNECT_API_URL: API }
  delete env.ELECTRON_RUN_AS_NODE
  const log = fs.openSync(path.join(data, 'app.log'), 'a')
  child = spawn(ELECTRON, [ROOT, `--user-data-dir=${data}`, `--remote-debugging-port=${DEBUG_PORT}`], { env, stdio: ['ignore', log, log] })

  const ui = await Page.open(await waitTarget(DEBUG_PORT, (t) => t.url.endsWith('index.html'), 60_000))
  await ui.waitFor<boolean>(`!!document.querySelector('button[title="Equipos"]')`, (v) => v === true)
  await ui.eval(`document.querySelector('button[title="Equipos"]').click()`)
  const button = `[...document.querySelectorAll('.settings-row')].filter((r) => r.innerText.includes(${JSON.stringify(pcName)})).map((r) => r.querySelector('button')).find((b) => b && !b.disabled)`
  await ui.waitFor<boolean>(`!!${button}`, (v) => v === true, 30_000)
  await ui.eval(`${button}.click()`)
  const viewer = await Page.open(await waitTarget(DEBUG_PORT, (t) => t.url.includes('viewer.html'), 20_000))
  await viewer.waitFor<string>('document.title', (title) => title === pcName, 15_000)
  await viewer.eval(`(() => { document.getElementById('password').value = ${JSON.stringify(PC_PASSWORD)}; document.getElementById('login').requestSubmit() })()`)
  const connected = await viewer.waitFor<boolean>(`document.getElementById('overlay').hidden && document.getElementById('status').textContent.includes('fps')`, (v) => v === true, 45_000)
  const status = await viewer.eval<string>(`document.getElementById('status').textContent`)
  check(`sesión con «${pcName}»`, connected === true, { status })
  if (connected) {
    console.log(`\n==> Sesión abierta como «${CONTROLLER_NAME}» durante ${seconds} s.\n`)
    await sleep(seconds * 1000)
  }
  await viewer.eval(`document.getElementById('disconnect').click()`).catch(() => undefined)
  viewer.close()
  ui.close()
}

electronApp.dock?.hide()
electronApp.on('window-all-closed', () => undefined)
void electronApp.whenReady().then(() =>
  run()
    .catch((error) => {
      report.error = describeError(error)
      console.error(error)
    })
    .finally(async () => {
      if (child && child.exitCode === null) {
        const exited = new Promise((resolve) => child!.once('exit', resolve))
        child.kill('SIGTERM')
        await Promise.race([exited, sleep(10_000)])
      }
      if (args.out) fs.writeFileSync(args.out, JSON.stringify(report, null, 2))
      electronApp.exit(report.error || report.checks.some((c) => c.ok === false) ? 1 : 0)
    })
)

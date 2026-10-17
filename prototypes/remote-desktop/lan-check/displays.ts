// Selector de pantallas (add-remote-desktop 6.5) contra un PC de prueba con varias pantallas en otro
// equipo (`pc.ts`, p. ej. `lan-test.sh <api> pc` en un Mac con un monitor externo o Sidecar). Maneja
// la app de este equipo por DevTools y comprueba con la sonda del PC que:
//   - la sesión empieza en la pantalla principal y el selector tiene todas las pantallas;
//   - al elegir otra, la imagen pasa a tener sus proporciones;
//   - el ratón cae en el punto equivalente de la pantalla elegida (centro y una esquina).
// Al terminar llama a /done para que el PC acabe también. Se ejecuta con Electron como Node:
//
//   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron prototypes/remote-desktop/lan-check/out/displays.cjs \
//     --api=http://<ip del backend>:8020 --work=<carpeta temporal> --out=<fichero.json> [--wait=30]
import { ChildProcess, spawn } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { Page, waitTarget } from '../lib/cdp'
import { api, args, API, createReport, lanAddress, login, PC_PASSWORD, PC_PREFIX, sleep, systemName, TEST_EMAIL } from './common'

const ROOT = path.resolve(__dirname, '..', '..', '..', '..')
const ELECTRON =
  process.platform === 'darwin'
    ? path.join(ROOT, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron')
    : path.join(ROOT, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron')
const WORK = args.work ?? ''
const DATA = path.join(WORK, 'controlador')
const DEBUG_PORT = 9337
const WAIT_MINUTES = Number(args.wait ?? 30)
const { report, check, note } = createReport('displays')

let probe = ''
let appProcess: ChildProcess | null = null

interface Display {
  id: string
  bounds: { x: number; y: number; width: number; height: number }
  scaleFactor: number
  primary: boolean
}

async function pc<T = any>(method: 'GET' | 'POST', pathname: string): Promise<T> {
  const response = await fetch(`${probe}${pathname}`, { method, signal: AbortSignal.timeout(30_000) })
  const data = await response.json()
  if (!response.ok) throw new Error(`sonda ${pathname}: ${JSON.stringify(data)}`)
  return data as T
}

/** El PC de prueba de otro equipo, disponible y con la sonda respondiendo. */
async function findPc(token: string): Promise<any> {
  const own = lanAddress()
  const deadline = Date.now() + WAIT_MINUTES * 60_000
  console.log(`==> Esperando a que el otro equipo aparezca como «${PC_PREFIX} …» (hasta ${WAIT_MINUTES} min)…`)
  while (Date.now() < deadline) {
    const { data } = await api('GET', '/api/devices', token).catch(() => ({ data: null }))
    for (const device of (data?.devices ?? []).filter((d: any) => d.online && d.remote?.state === 'available' && d.name.startsWith(PC_PREFIX) && !d.name.includes(`@${own}:`))) {
      const address = device.name.match(/@([\d.]+:\d+)$/)?.[1]
      if (!address) continue
      probe = `http://${address}`
      if (await pc('GET', '/state').then(() => true).catch(() => false)) return device
    }
    await sleep(3000)
  }
  throw new Error(`No aparece ningún PC de prueba en ${WAIT_MINUTES} min`)
}

async function run(): Promise<void> {
  if (!WORK) throw new Error('Falta --work')
  fs.rmSync(WORK, { recursive: true, force: true })
  fs.mkdirSync(DATA, { recursive: true })
  const token = await login(`Controlador ${systemName()} de prueba`)
  const observer = await login(`Observador ${systemName()} de prueba`)
  const device = await findPc(observer)
  const first = await pc<{ platform: string; displays: Display[] }>('GET', '/state')
  check('el PC de prueba aparece y su sonda responde', true, { name: device.name, displays: first.displays.map((d) => ({ id: d.id, bounds: d.bounds, scale: d.scaleFactor, primary: d.primary })) })
  if (first.displays.length < 2) {
    check('el PC tiene al menos dos pantallas', null, `solo tiene ${first.displays.length}: conecta otra (o usa Sidecar) y vuelve a lanzarlo`)
    return
  }

  fs.writeFileSync(path.join(DATA, 'session.json'), JSON.stringify({ email: TEST_EMAIL, token, encrypted: false }))
  fs.writeFileSync(path.join(DATA, 'settings.json'), JSON.stringify({ theme: 'dark', language: 'es', keepInBackground: false, openAtLogin: false }))
  const env: NodeJS.ProcessEnv = { ...process.env, ABSOR_CONNECT_API_URL: API }
  delete env.ELECTRON_RUN_AS_NODE
  const log = fs.openSync(path.join(DATA, 'app.log'), 'a')
  appProcess = spawn(ELECTRON, [ROOT, `--user-data-dir=${DATA}`, `--remote-debugging-port=${DEBUG_PORT}`], { env, stdio: ['ignore', log, log] })

  const ui = await Page.open(await waitTarget(DEBUG_PORT, (t) => t.url.endsWith('index.html'), 60_000))
  await ui.waitFor<boolean>(`!!document.querySelector('button[title="Equipos"]')`, (v) => v === true)
  await ui.eval(`document.querySelector('button[title="Equipos"]').click()`)
  const button = `[...document.querySelectorAll('.settings-row')].filter((r) => r.innerText.includes(${JSON.stringify(device.name)})).map((r) => r.querySelector('button')).find((b) => b && !b.disabled)`
  await ui.waitFor<boolean>(`!!${button}`, (v) => v === true, 30_000)
  await ui.eval(`${button}.click()`)
  const viewer = await Page.open(await waitTarget(DEBUG_PORT, (t) => t.url.includes('viewer.html'), 20_000))
  await viewer.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await viewer.waitFor<string>('document.title', (title) => title === device.name, 15_000)
  await viewer.eval(`(() => { document.getElementById('password').value = ${JSON.stringify(PC_PASSWORD)}; document.getElementById('login').requestSubmit() })()`)
  const connected = await viewer.waitFor<boolean>(`document.getElementById('overlay').hidden && document.getElementById('status').textContent.includes('fps')`, (v) => v === true, 30_000)
  check('el controlador se conecta al PC', connected === true, connected)

  // Al empezar: la pantalla principal, y un selector con todas
  const selector = await viewer.waitFor<{ hidden: boolean; options: string[]; current: string }>(
    `(() => { const s = document.getElementById('displays'); return { hidden: s.hidden, options: [...s.options].map((o) => o.value), current: s.value } })()`,
    (s) => !!s && !s.hidden && s.options.length === first.displays.length,
    15_000
  )
  const primary = first.displays.find((d) => d.primary)!
  check('la sesión empieza en la pantalla principal y el selector tiene todas', !selector.hidden && selector.options.length === first.displays.length && selector.current === primary.id, { selector, primary: primary.id })

  // Cada pantalla: la imagen con sus proporciones y el ratón en su sitio
  const pointAt = async (fx: number, fy: number): Promise<void> => {
    const at = await viewer.eval<{ x: number; y: number }>(`(() => {
      const v = document.getElementById('video'); const r = v.getBoundingClientRect()
      const s = Math.min(r.width / v.videoWidth, r.height / v.videoHeight)
      const w = v.videoWidth * s, h = v.videoHeight * s
      return { x: r.left + (r.width - w) / 2 + w * ${fx}, y: r.top + (r.height - h) / 2 + h * ${fy} }
    })()`)
    await viewer.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y })
    await sleep(800)
  }
  for (const display of [...first.displays.filter((d) => !d.primary), primary]) {
    await viewer.eval(`(() => { const s = document.getElementById('displays'); s.value = ${JSON.stringify(display.id)}; s.dispatchEvent(new Event('change')) })()`)
    const ratio = display.bounds.width / display.bounds.height
    const size = await viewer.waitFor<{ w: number; h: number }>(`({ w: document.getElementById('video').videoWidth, h: document.getElementById('video').videoHeight })`, (s) => !!s && s.w > 0 && Math.abs(s.w / s.h - ratio) < 0.02, 15_000)
    await sleep(1000)
    const results: Record<string, unknown> = {}
    let pointerOk = true
    for (const [label, fx, fy] of [['centro', 0.5, 0.5], ['esquina', 0.1, 0.1]] as const) {
      await pointAt(fx, fy)
      const { pointer } = await pc<{ pointer: { x: number; y: number } }>('GET', '/state')
      const expected = { x: Math.round(display.bounds.x + display.bounds.width * fx), y: Math.round(display.bounds.y + display.bounds.height * fy) }
      const ok = Math.abs(pointer.x - expected.x) <= 3 && Math.abs(pointer.y - expected.y) <= 3
      pointerOk &&= ok
      results[label] = { pointer, expected }
    }
    const name = display.primary ? 'principal' : `${display.bounds.width}×${display.bounds.height} @${display.scaleFactor}x`
    check(`pantalla ${name}: la imagen tiene sus proporciones y el ratón cae en ella`, !!size && Math.abs(size.w / size.h - ratio) < 0.02 && pointerOk, { size, bounds: display.bounds, ...results })
  }

  await viewer.eval(`document.getElementById('disconnect').click()`).catch(() => undefined)
  viewer.close()
  ui.close()
}

run()
  .catch((error) => {
    report.error = String(error instanceof Error ? (error.stack ?? error) : error)
    console.error(error)
  })
  .finally(async () => {
    if (probe) await pc('POST', '/done').catch(() => note('el PC no ha respondido a /done'))
    if (appProcess && appProcess.exitCode === null) {
      const exited = new Promise((resolve) => appProcess!.once('exit', resolve))
      appProcess.kill('SIGTERM')
      await Promise.race([exited, sleep(10_000)])
    }
    if (args.out) fs.writeFileSync(args.out, JSON.stringify(report, null, 2))
    const failed = report.checks.filter((c) => c.ok === false).length
    console.log(`\n${report.checks.filter((c) => c.ok).length}/${report.checks.length} comprobaciones bien.`)
    process.exit(failed === 0 && !report.error ? 0 : 1)
  })

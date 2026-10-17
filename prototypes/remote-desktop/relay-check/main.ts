// Sesión solo por relé contra el TURN de verdad (add-remote-desktop 3.1 y 3.2), en un solo Linux:
// un PC (oculto) y un controlador obligado a usar el relé (ABSOR_CONNECT_FORCE_RELAY, es decir,
// iceTransportPolicy 'relay'). Comprueba que la API da el TURN, que la sesión conecta, que el visor
// dice "Por relé" y que el par elegido pasa por el relé esperado.
//
//   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron prototypes/remote-desktop/relay-check/out/main.cjs \
//     --api=<API> --work=<carpeta temporal> --out=<fichero.json> --relay-ip=46.38.240.212 \
//     [--turn-host=turn.absor.top] [--delete-account=1]
//
// Contra producción usa la cuenta de prueba (la crea si no existe); --delete-account=1 la borra al
// terminar, con sus equipos.
import { ChildProcess, spawn } from 'child_process'
import * as fs from 'fs'
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
const RELAY_IP = args['relay-ip'] ?? ''
const TURN_HOST = args['turn-host'] ?? ''
const PC_PORT = 9334
const CONTROLLER_PORT = 9333
const TEST_EMAIL = 'prueba-control-local@example.test'
const ACCOUNT_PASSWORD = 'contraseña-de-prueba-larga'
const PC_PASSWORD = 'contraseña-del-pc-prueba'
const PC_NAME = `PC de prueba relé ${new Date().toTimeString().slice(0, 8)}`

interface Check {
  name: string
  ok: boolean
  detail: unknown
}
const report: { api: string; checks: Check[]; error: string | null } = { api: API, checks: [], error: null }
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function check(name: string, ok: boolean, detail: unknown): void {
  report.checks.push({ name, ok, detail })
  console.log(`${ok ? 'OK   ' : 'FALLO'} ${name} ${String(JSON.stringify(detail)).slice(0, 500)}`)
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

function writeSession(dir: string, token: string): void {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify({ email: TEST_EMAIL, token, encrypted: false }))
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ theme: 'dark', language: 'es', keepInBackground: false, openAtLogin: false }))
}

const children: ChildProcess[] = []

function launch(dir: string, port: number, env: Record<string, string>, extra: string[] = []): void {
  const log = fs.openSync(path.join(dir, 'app.log'), 'a')
  children.push(
    spawn(ELECTRON, [ROOT, `--user-data-dir=${dir}`, `--remote-debugging-port=${port}`, ...extra], {
      env: { ...process.env, ABSOR_CONNECT_API_URL: API, ELECTRON_RUN_AS_NODE: '', ...env },
      stdio: ['ignore', log, log]
    })
  )
}

let observerToken = ''

async function run(): Promise<void> {
  if (!WORK || !RELAY_IP) throw new Error('Faltan --work y --relay-ip')
  fs.rmSync(WORK, { recursive: true, force: true })
  observerToken = await login('Observador de prueba')

  // Lo que da la API: el TURN, con credenciales temporales
  const { status, data } = await api('GET', '/api/remote/ice-servers', observerToken)
  const servers: { urls: string | string[]; username?: string; credential?: string }[] = data?.iceServers ?? []
  const turn = servers.flatMap((s) => (Array.isArray(s.urls) ? s.urls : [s.urls]).map((url) => ({ url, username: s.username, hasCredential: !!s.credential })))
  const turnUrls = turn.filter((t) => /^turns?:/.test(t.url))
  const expiry = Number(String(turnUrls[0]?.username ?? '').split(':')[0])
  const hours = (expiry * 1000 - Date.now()) / 3_600_000
  check('la API da el TURN con credenciales que caducan en unas 24 h', status === 200 && turnUrls.length > 0 && turnUrls.every((t) => t.hasCredential) && hours > 23 && hours <= 24.1 && (!TURN_HOST || turnUrls.every((t) => t.url.includes(TURN_HOST))), { status, urls: turn.map((t) => t.url), hours: Math.round(hours * 10) / 10 })
  // La caducidad va redondeada a la hora: la misma cuenta recibe el mismo usuario (la cuota del relé cuenta por usuario)
  const again = await api('GET', '/api/remote/ice-servers', observerToken)
  const againUser = (again.data?.iceServers ?? []).find((s: { username?: string }) => s.username)?.username
  const sameHour = Math.floor(Date.now() / 3_600_000) === Math.floor((expiry - 86_400) / 3600)
  check('dos peticiones en la misma hora dan el mismo usuario TURN', !sameHour || againUser === turnUrls[0]?.username, { sameHour, first: turnUrls[0]?.username?.split(':')[0], second: againUser?.split(':')[0] })

  // El PC y el controlador (solo relé)
  const pcDir = path.join(WORK, 'pc')
  writeSession(pcDir, await login(PC_NAME))
  const store = new RemoteAccessStore(path.join(pcDir, 'remote-access.json'), createPlaintextBox(), PC_NAME)
  await store.bindToAccount(TEST_EMAIL)
  await store.setPassword(PC_PASSWORD)
  await store.setDeviceName(PC_NAME)
  await store.setEnabled(true)
  launch(pcDir, PC_PORT, {}, ['--hidden'])
  const controllerDir = path.join(WORK, 'controlador')
  writeSession(controllerDir, await login('Controlador de prueba (relé)'))
  launch(controllerDir, CONTROLLER_PORT, { ABSOR_CONNECT_FORCE_RELAY: '1' })

  const ui = await Page.open(await waitTarget(CONTROLLER_PORT, (t) => t.url.endsWith('index.html'), 60_000))
  await ui.waitFor<boolean>(`!!document.querySelector('button[title="Equipos"]')`, (v) => v === true, 30_000)
  await ui.eval(`document.querySelector('button[title="Equipos"]').click()`)
  await ui.waitFor<string>(`[...document.querySelectorAll('.settings-row')].find((r) => r.innerText.includes(${JSON.stringify(PC_NAME)}))?.innerText ?? ''`, (t) => t.includes('Disponible'), 60_000)
  await ui.eval(`[...document.querySelectorAll('.settings-row')].find((r) => r.innerText.includes(${JSON.stringify(PC_NAME)})).querySelector('button').click()`)
  const viewer = await Page.open(await waitTarget(CONTROLLER_PORT, (t) => t.url.includes('viewer.html')))
  await viewer.waitFor<boolean>(`!!document.getElementById('password')`, (v) => v === true, 15_000)
  // Se guarda la conexión para ver su política y el par elegido
  await viewer.eval(`(() => {
    const Original = window.RTCPeerConnection
    window.peerConnections = []
    window.RTCPeerConnection = function (...a) { const pc = new Original(...a); window.peerConnections.push(pc); return pc }
    window.RTCPeerConnection.prototype = Original.prototype
  })()`)
  const started = Date.now()
  await viewer.eval(`(() => { document.getElementById('password').value = ${JSON.stringify(PC_PASSWORD)}; document.getElementById('login').requestSubmit() })()`)
  const connected = await viewer.waitFor<boolean>(`document.getElementById('overlay').hidden && document.getElementById('status').textContent.includes('fps')`, (v) => v === true, 45_000)
  const seconds = Math.round((Date.now() - started) / 100) / 10
  await sleep(3000)
  const statusText = await viewer.eval<string>(`document.getElementById('status').textContent`)
  check('la sesión solo por relé conecta y el visor dice "Por relé"', connected === true && statusText.includes('Por relé'), { seconds, status: statusText })

  const pair = await viewer.eval<any>(`(async () => {
    const pc = window.peerConnections.at(-1)
    const stats = await pc.getStats()
    let pair = null
    stats.forEach((s) => { if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') pair = s })
    const local = pair && stats.get(pair.localCandidateId), remote = pair && stats.get(pair.remoteCandidateId)
    return { policy: pc.getConfiguration().iceTransportPolicy, local: local && { type: local.candidateType, address: local.address, relayProtocol: local.relayProtocol, url: local.url }, remote: remote && { type: remote.candidateType, address: remote.address }, rtt: pair?.currentRoundTripTime }
  })()`)
  check(`el par elegido pasa por el relé ${RELAY_IP}`, pair?.policy === 'relay' && pair?.local?.type === 'relay' && pair?.local?.address === RELAY_IP, pair)

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
    for (const child of children) {
      if (child.exitCode !== null) continue
      const exited = new Promise((resolve) => child.once('exit', resolve))
      child.kill('SIGTERM')
      await Promise.race([exited, sleep(10_000)])
    }
    if (args['delete-account'] === '1' && observerToken) {
      const deleted = await api('DELETE', '/api/me', observerToken, { password: ACCOUNT_PASSWORD }).catch((e) => ({ status: String(e) }))
      console.log(`Cuenta de prueba borrada: ${deleted.status}`)
      ;(report as Record<string, unknown>).accountDeleted = deleted.status
    }
    if (args.out) fs.writeFileSync(args.out, JSON.stringify(report, null, 2))
    const failed = report.checks.filter((c) => !c.ok).length
    console.log(`\n${report.checks.length - failed}/${report.checks.length} comprobaciones bien.`)
    process.exit(failed === 0 && !report.error ? 0 : 1)
  })

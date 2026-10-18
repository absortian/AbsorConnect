// Cortafuegos de Windows con el instalador NSIS (add-remote-desktop 9.3 y 6.2): al activar el control
// remoto, Windows pregunta ya si deja a la app usar la red (primeFirewall), y Ajustes muestra la pista
// de elegir "Permitir". Se ejecuta en la VM, en la sesión gráfica (tarea programada /it), con el
// Electron de una copia del repo como Node:
//
//   set ELECTRON_RUN_AS_NODE=1
//   electron.exe windows-firewall.cjs --api=http://<backend>:8020 --work=<carpeta> --out=<fichero.json> \
//     --app=%LOCALAPPDATA%\Programs\absor-file-explorer\AbsorConnect.exe
//
// Quita antes las reglas que Windows guardó para la app en pruebas anteriores (si no, no vuelve a
// preguntar) y, al terminar, cierra el aviso sin contestarlo, así que no deja reglas nuevas.
import { ChildProcess, execFileSync, spawn } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { Page, waitTarget } from '../lib/cdp'
import { API, args, login, PC_PASSWORD, sleep, TEST_EMAIL } from '../lan-check/common'

const PORT = 9337
const HINT = 'Windows puede preguntar si permites que Absor Connect use la red'
const checks: { name: string; ok: boolean; detail: unknown }[] = []
const notes: string[] = []
let app: ChildProcess | null = null

function check(name: string, ok: boolean, detail: unknown): void {
  checks.push({ name, ok, detail })
  console.log(`${ok ? 'OK   ' : 'FALLO'} ${name} ${JSON.stringify(detail)}`)
}

function ps(command: string): string {
  try {
    return execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8' }).trim()
  } catch (error) {
    return `ERROR ${(error as Error).message.slice(0, 200)}`
  }
}

/** Ventanas del aviso del cortafuegos ("Windows Security", proceso PickerHost) abiertas ahora. */
function prompts(): string[] {
  const out = ps(`Get-Process PickerHost -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle } | ForEach-Object { $_.MainWindowTitle }`)
  return out && !out.startsWith('ERROR') ? out.split(/\r?\n/) : []
}

function screenshot(file: string): void {
  ps(
    `Add-Type -AssemblyName System.Windows.Forms, System.Drawing; $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; ` +
      `$i = New-Object System.Drawing.Bitmap $b.Width, $b.Height; [System.Drawing.Graphics]::FromImage($i).CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size); ` +
      `$i.Save('${file.replace(/'/g, "''")}')`
  )
}

async function run(): Promise<void> {
  if (!args.app || !args.work || !args.out) throw new Error('Faltan --app, --work y --out')
  const removed = ps(
    `(Get-NetFirewallApplicationFilter | Where-Object Program -like '*absorconnect.exe' | Get-NetFirewallRule | Remove-NetFirewallRule -PassThru | Measure-Object).Count`
  )
  notes.push(`reglas anteriores de absorconnect.exe quitadas: ${removed}`)
  ps(`Get-Process PickerHost -ErrorAction SilentlyContinue | Stop-Process -Force`)

  const data = path.join(args.work, 'data')
  fs.rmSync(data, { recursive: true, force: true })
  fs.mkdirSync(data, { recursive: true })
  const token = await login('PC de prueba Windows (cortafuegos)')
  fs.writeFileSync(path.join(data, 'session.json'), JSON.stringify({ email: TEST_EMAIL, token, encrypted: false }))
  fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({ theme: 'dark', language: 'es', keepInBackground: false, openAtLogin: false }))
  const env: NodeJS.ProcessEnv = { ...process.env, ABSOR_CONNECT_API_URL: API }
  delete env.ELECTRON_RUN_AS_NODE
  app = spawn(args.app, [`--user-data-dir=${data}`, `--remote-debugging-port=${PORT}`], { env, stdio: 'ignore' })

  const page = await Page.open(await waitTarget(PORT, (t) => t.url.endsWith('index.html'), 60_000))
  await page.waitFor<boolean>(`!!document.querySelector('button[title="Ajustes"]')`, (v) => v === true, 30_000)
  await page.eval(`document.querySelector('button[title="Ajustes"]').click()`)
  const panel = (): Promise<string> => page.eval<string>(`document.querySelector('.settings-panel')?.innerText ?? ''`)
  await page.waitFor<string>(`document.querySelector('.settings-panel')?.innerText ?? ''`, (t) => t.includes('Control remoto de este PC'), 30_000)
  const hintBefore = (await panel()).includes(HINT)
  const promptsBefore = prompts()

  // La contraseña por la misma llamada que el diálogo de Ajustes; el interruptor, pulsado en la página
  const password = await page.eval<any>(`window.api.setRemotePassword(${JSON.stringify(PC_PASSWORD)})`)
  // Ajustes se refresca cada 3 s: con el interruptor pulsado antes, abriría el formulario de crear la contraseña
  await page.waitFor<string>(`document.querySelector('.settings-panel')?.innerText ?? ''`, (t) => t.includes('Definida.'), 15_000)
  await page.waitFor<boolean>(`!!document.querySelector('input[aria-label="Permitir controlar este PC"]:not([disabled])')`, (v) => v === true, 30_000)
  await page.eval(`document.querySelector('input[aria-label="Permitir controlar este PC"]').click()`)
  let asked: string[] = []
  for (let i = 0; i < 40 && asked.length === 0; i++) {
    await sleep(500)
    asked = prompts()
  }
  await sleep(1500)
  screenshot(path.join(path.dirname(args.out), 'firewall.png'))
  const text = await page.waitFor<string>(`document.querySelector('.settings-panel')?.innerText ?? ''`, (t) => t.includes(HINT), 10_000).catch(() => panel())
  const enabled = await page.eval<any>(`window.api.remoteSettings().then((r) => r.state?.enabled)`)

  check('con el control remoto desactivado, Ajustes no muestra la pista del cortafuegos', !hintBefore, { promptsBefore })
  check('al activarlo, Windows pregunta ya por el cortafuegos (primeFirewall)', asked.length > 0, { asked, passwordSet: password?.ok, enabled })
  check('y Ajustes muestra la pista de elegir "Permitir"', text.includes(HINT), text.split('\n').find((l) => l.includes('Windows puede')) ?? null)
  page.close()

  // Contraseña local del PC en Windows: ni en claro en la carpeta de datos, y K cifrada (DPAPI)
  const forms = [PC_PASSWORD.normalize('NFC'), PC_PASSWORD.normalize('NFD')].flatMap((p) => [Buffer.from(p, 'utf8'), Buffer.from(p, 'utf16le')])
  const files = (fs.readdirSync(data, { recursive: true }) as string[]).map((f) => path.join(data, f)).filter((f) => fs.statSync(f).isFile())
  const found = files.filter((f) => {
    try {
      const bytes = fs.readFileSync(f)
      return forms.some((form) => bytes.includes(form))
    } catch {
      return false
    }
  })
  const stored = JSON.parse(fs.readFileSync(path.join(data, 'remote-access.json'), 'utf8')).password ?? {}
  check('la contraseña no está en claro en la carpeta de datos, y K va cifrada', found.length === 0 && String(stored.key).startsWith('v1:'), {
    files: files.length,
    found: found.map((f) => path.relative(data, f)),
    keyBox: String(stored.key).slice(0, 3),
    iterations: stored.iterations
  })
}

run()
  .catch((error) => {
    check('la prueba llega al final', false, error instanceof Error ? error.message : String(error))
  })
  .finally(() => {
    // El aviso se cierra sin contestarlo: Windows no guarda reglas
    ps(`Get-Process PickerHost -ErrorAction SilentlyContinue | Stop-Process -Force`)
    app?.kill()
    ps(`Get-Process AbsorConnect -ErrorAction SilentlyContinue | Stop-Process -Force`)
    if (args.out) fs.writeFileSync(args.out, JSON.stringify({ checks, notes }, null, 2))
    process.exit(0)
  })

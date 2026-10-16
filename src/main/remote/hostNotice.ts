// Lo que ve quien está delante del PC controlado (add-remote-desktop D7, remote-access-host):
//   - el aviso siempre encima con el nombre del controlador y "Desconectar" durante toda la sesión;
//   - la pregunta de confirmación local, que se rechaza sola a los 30 s;
//   - las notificaciones al empezar y al terminar cada sesión.
import { BrowserWindow, Notification, screen } from 'electron'

const NOTICE_WIDTH = 420
const NOTICE_HEIGHT = 52
const CONFIRM_WIDTH = 460
const CONFIRM_HEIGHT = 210
const CONFIRM_TIMEOUT_MS = 30_000
/** Título de la ventana de confirmación (las pruebas la buscan por él). */
export const CONFIRM_WINDOW_TITLE = 'Absor Connect — confirmación'

interface Texts {
  controlling: (controller: string) => string
  disconnect: string
  confirmMessage: (controller: string) => string
  confirmDetail: string
  allow: string
  deny: string
  /** `{s}` son los segundos que quedan. */
  countdown: string
  sessionStarted: (controller: string) => string
  sessionEnded: (controller: string) => string
}

const TEXTS: Record<'es' | 'en', Texts> = {
  es: {
    controlling: (c) => `${c} está controlando este PC`,
    disconnect: 'Desconectar',
    confirmMessage: (c) => `${c} quiere controlar este PC`,
    confirmDetail:
      'Ha escrito la contraseña correcta. Si nadie responde en 30 segundos, se rechaza.',
    allow: 'Permitir',
    deny: 'Rechazar',
    countdown: 'Se rechaza sola en {s} s',
    sessionStarted: (c) => `${c} está controlando este PC.`,
    sessionEnded: (c) => `${c} ha dejado de controlar este PC.`
  },
  en: {
    controlling: (c) => `${c} is controlling this PC`,
    disconnect: 'Disconnect',
    confirmMessage: (c) => `${c} wants to control this PC`,
    confirmDetail:
      'They entered the correct password. If nobody answers in 30 seconds, it is declined.',
    allow: 'Allow',
    deny: 'Decline',
    countdown: 'Declined automatically in {s} s',
    sessionStarted: (c) => `${c} is controlling this PC.`,
    sessionEnded: (c) => `${c} stopped controlling this PC.`
  }
}

function texts(language: string): Texts {
  return TEXTS[language === 'es' ? 'es' : 'en']
}

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  )
}

/**
 * Aviso siempre encima, arriba en el centro de la pantalla principal. "Desconectar" cierra la
 * ventana y `onDisconnect` corta la sesión; cerrarla desde el código (al terminar) no avisa.
 */
export function openSessionNotice(
  controller: string,
  language: string,
  onDisconnect: () => void
): { close(): void } {
  const t = texts(language)
  const { workArea } = screen.getPrimaryDisplay()
  const window = new BrowserWindow({
    x: Math.round(workArea.x + (workArea.width - NOTICE_WIDTH) / 2),
    y: workArea.y + 8,
    width: NOTICE_WIDTH,
    height: NOTICE_HEIGHT,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    show: false,
    backgroundColor: '#1d2433',
    webPreferences: { sandbox: true, contextIsolation: true }
  })
  window.setAlwaysOnTop(true, 'screen-saver')
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  // Windows 10 2004+ y macOS: el controlador no lo ve tapando su imagen (en X11 no se puede)
  window.setContentProtection(true)

  let closingFromCode = false
  window.on('closed', () => {
    if (!closingFromCode) onDisconnect()
  })
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Absor Connect — aviso</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
html,body{margin:0;height:100%;overflow:hidden;font:14px system-ui,sans-serif;color:#e6e9ef;background:#1d2433;user-select:none}
body{display:flex;align-items:center;gap:12px;padding:0 10px 0 14px;box-sizing:border-box;border:2px solid #e5484d;border-radius:8px}
.dot{width:10px;height:10px;border-radius:50%;background:#e5484d;flex:none}
.text{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
button{font:inherit;color:#fff;background:#e5484d;border:0;border-radius:6px;padding:6px 12px;cursor:pointer}
</style></head><body>
<span class="dot"></span><span class="text">${escapeHtml(t.controlling(controller))}</span>
<button id="disconnect">${escapeHtml(t.disconnect)}</button>
<script>document.getElementById('disconnect').onclick = () => window.close()</script>
</body></html>`
  void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  window.once('ready-to-show', () => window.showInactive())

  return {
    close: () => {
      closingFromCode = true
      if (!window.isDestroyed()) window.destroy()
    }
  }
}

/**
 * Pregunta a quien esté delante si acepta la conexión; sin respuesta en 30 s, la rechaza. Es una
 * ventana propia y no `dialog.showMessageBox`: en macOS, sin ventana padre, ese diálogo es síncrono
 * (bloquea el proceso principal, y con él la consulta a la API y la negociación) y no atiende
 * `signal`, así que nunca se rechazaba solo.
 */
export function confirmLocally(controller: string, language: string): Promise<boolean> {
  const t = texts(language)
  const { workArea } = screen.getPrimaryDisplay()
  const window = new BrowserWindow({
    x: Math.round(workArea.x + (workArea.width - CONFIRM_WIDTH) / 2),
    y: Math.round(workArea.y + (workArea.height - CONFIRM_HEIGHT) / 3),
    width: CONFIRM_WIDTH,
    height: CONFIRM_HEIGHT,
    title: CONFIRM_WINDOW_TITLE,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    // macOS: el primer clic pulsa el botón aunque la app no esté activa
    acceptFirstMouse: true,
    show: false,
    backgroundColor: '#1d2433',
    webPreferences: { sandbox: true, contextIsolation: true }
  })
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  // Los botones cambian el título de la página: así responde sin preload ni IPC
  const seconds = Math.round(CONFIRM_TIMEOUT_MS / 1000)
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${CONFIRM_WINDOW_TITLE}</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
html,body{margin:0;height:100%;overflow:hidden;font:14px system-ui,sans-serif;color:#e6e9ef;background:#1d2433;user-select:none}
body{display:flex;flex-direction:column;gap:10px;padding:18px 20px;box-sizing:border-box;border:2px solid #5b6cf0;border-radius:10px}
h1{margin:0;font-size:16px} p{margin:0;color:#b4bccb;line-height:1.4} #countdown{color:#facc15}
.actions{margin-top:auto;display:flex;justify-content:flex-end;gap:10px}
button{font:inherit;border:0;border-radius:6px;padding:7px 16px;cursor:pointer;color:#fff}
#deny{background:#3a4357} #allow{background:#5b6cf0}
</style></head><body>
<h1>${escapeHtml(t.confirmMessage(controller))}</h1>
<p>${escapeHtml(t.confirmDetail)}</p>
<p id="countdown"></p>
<div class="actions"><button id="deny">${escapeHtml(t.deny)}</button><button id="allow">${escapeHtml(t.allow)}</button></div>
<script>
const answer = (value) => { document.title = value }
document.getElementById('allow').onclick = () => answer('allow')
document.getElementById('deny').onclick = () => answer('deny')
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') answer('deny') })
document.getElementById('deny').focus()
let left = ${seconds}
const tick = () => { document.getElementById('countdown').textContent = ${JSON.stringify(t.countdown)}.replace('{s}', left); left = Math.max(0, left - 1) }
tick(); setInterval(tick, 1000)
</script>
</body></html>`

  return new Promise((resolve) => {
    let answered = false
    const finish = (allowed: boolean): void => {
      if (answered) return
      answered = true
      clearTimeout(timer)
      if (!window.isDestroyed()) window.destroy()
      resolve(allowed)
    }
    const timer = setTimeout(() => finish(false), CONFIRM_TIMEOUT_MS)
    window.webContents.on('page-title-updated', (event, title) => {
      event.preventDefault()
      if (title === 'allow') finish(true)
      else if (title === 'deny') finish(false)
    })
    window.on('closed', () => finish(false))
    window.once('ready-to-show', () => {
      window.show()
      window.focus()
    })
    void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  })
}

export function notifySession(
  event: 'session-start' | 'session-end',
  controller: string,
  language: string,
  onClick?: () => void
): void {
  if (!Notification.isSupported()) return
  const t = texts(language)
  const notification = new Notification({
    title: 'Absor Connect',
    body: event === 'session-start' ? t.sessionStarted(controller) : t.sessionEnded(controller)
  })
  if (onClick) notification.on('click', onClick)
  notification.show()
}

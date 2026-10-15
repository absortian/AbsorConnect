// Lo que ve quien está delante del PC controlado (add-remote-desktop D7, remote-access-host):
//   - el aviso siempre encima con el nombre del controlador y "Desconectar" durante toda la sesión;
//   - la pregunta de confirmación local, que se rechaza sola a los 30 s;
//   - las notificaciones al empezar y al terminar cada sesión.
import { BrowserWindow, dialog, Notification, screen } from 'electron'

const NOTICE_WIDTH = 420
const NOTICE_HEIGHT = 52
const CONFIRM_TIMEOUT_MS = 30_000

interface Texts {
  controlling: (controller: string) => string
  disconnect: string
  confirmTitle: string
  confirmMessage: (controller: string) => string
  confirmDetail: string
  allow: string
  deny: string
  sessionStarted: (controller: string) => string
  sessionEnded: (controller: string) => string
}

const TEXTS: Record<'es' | 'en', Texts> = {
  es: {
    controlling: (c) => `${c} está controlando este PC`,
    disconnect: 'Desconectar',
    confirmTitle: 'Control remoto',
    confirmMessage: (c) => `${c} quiere controlar este PC`,
    confirmDetail:
      'Ha escrito la contraseña correcta. Si nadie responde en 30 segundos, se rechaza.',
    allow: 'Permitir',
    deny: 'Rechazar',
    sessionStarted: (c) => `${c} está controlando este PC.`,
    sessionEnded: (c) => `${c} ha dejado de controlar este PC.`
  },
  en: {
    controlling: (c) => `${c} is controlling this PC`,
    disconnect: 'Disconnect',
    confirmTitle: 'Remote control',
    confirmMessage: (c) => `${c} wants to control this PC`,
    confirmDetail:
      'They entered the correct password. If nobody answers in 30 seconds, it is declined.',
    allow: 'Allow',
    deny: 'Decline',
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

/** Pregunta a quien esté delante si acepta la conexión; sin respuesta en 30 s, la rechaza. */
export async function confirmLocally(controller: string, language: string): Promise<boolean> {
  const t = texts(language)
  const { response } = await dialog.showMessageBox({
    type: 'question',
    title: t.confirmTitle,
    message: t.confirmMessage(controller),
    detail: t.confirmDetail,
    buttons: [t.allow, t.deny],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    signal: AbortSignal.timeout(CONFIRM_TIMEOUT_MS)
  })
  return response === 0
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

// Lectura real del estado de support.ts en este equipo, y lo que se hace con él en macOS: abrir el
// panel de cada permiso en Ajustes del Sistema y avisar cuando se pierde (add-remote-desktop D8).
//
// macOS asocia los permisos a la firma de la app, y con la firma ad-hoc cambia en cada versión: tras
// una actualización los permisos pueden aparecer concedidos en Ajustes y no valer. Hay que quitar la
// app de la lista y volver a añadirla (lo explica Ajustes de la app).
import { desktopCapturer, Notification, shell, systemPreferences } from 'electron'
import {
  evaluateSupport,
  MacPermission,
  missingPermissionsMessage,
  RemoteSupport,
  SupportMonitor
} from './support'

const PANES: Record<MacPermission, string> = {
  screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
}

/** Tiempo máximo de la petición del permiso de grabación (sin él, la captura puede no responder). */
const SCREEN_REQUEST_TIMEOUT_MS = 3000

export function detectSupport(): RemoteSupport {
  const mac = process.platform === 'darwin'
  return evaluateSupport({
    platform: process.platform,
    env: process.env,
    screenGranted: mac ? systemPreferences.getMediaAccessStatus('screen') === 'granted' : undefined,
    accessibilityTrusted: mac ? systemPreferences.isTrustedAccessibilityClient(false) : undefined
  })
}

/**
 * Pide el permiso y abre su panel de Ajustes del Sistema. Pedirlo es lo que añade la app a la
 * lista del panel (y macOS muestra su propio aviso la primera vez); si ya lo tiene, no pasa nada.
 */
export async function openPermissionSettings(permission: MacPermission): Promise<void> {
  if (process.platform !== 'darwin') return
  if (permission === 'accessibility') {
    systemPreferences.isTrustedAccessibilityClient(true)
  } else {
    const request = desktopCapturer
      .getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
      .catch(() => undefined)
    await Promise.race([
      request,
      new Promise((resolve) => setTimeout(resolve, SCREEN_REQUEST_TIMEOUT_MS))
    ])
  }
  await shell.openExternal(PANES[permission])
}

export function notifyMissingPermissions(
  missing: MacPermission[],
  options: { language: string; onClick?: () => void }
): void {
  if (missing.length === 0 || !Notification.isSupported()) return
  const notification = new Notification({
    title: 'Absor Connect',
    body: missingPermissionsMessage(missing, options.language, process.getSystemVersion())
  })
  if (options.onClick) notification.on('click', options.onClick)
  notification.show()
}

/** Monitor con los permisos reales y la notificación del sistema, en el idioma de la app. */
export function createSupportMonitor(options: {
  language: () => Promise<string>
  onClick?: () => void
  onChange?: (support: RemoteSupport) => void
}): SupportMonitor {
  return new SupportMonitor({
    detect: detectSupport,
    notifyMissing: (missing) => {
      void options
        .language()
        .catch(() => 'en')
        .then((language) =>
          notifyMissingPermissions(missing, { language, onClick: options.onClick })
        )
    },
    onChange: options.onChange
  })
}

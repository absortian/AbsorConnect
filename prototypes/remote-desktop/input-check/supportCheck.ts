// Modo `--mode=support` (tarea 4.7 de add-remote-desktop): el estado del control remoto en este
// equipo con el módulo real (src/main/remote/platformSupport.ts).
//   - Linux: el estado con la sesión actual y con una sesión Wayland simulada.
//   - macOS: pregunta con diálogos si el estado coincide con Ajustes del Sistema, si se abre el
//     panel de cada permiso y si llega la notificación de permisos perdidos. Lanzado desde
//     Terminal, los permisos que cuentan son los de Terminal.
import { app, dialog } from 'electron'
import {
  detectSupport,
  notifyMissingPermissions,
  openPermissionSettings
} from '../../../src/main/remote/platformSupport'
import { evaluateSupport, isWaylandSession, MacPermission, RemoteSupport } from '../../../src/main/remote/support'

type CheckFn = (name: string, ok: boolean, detail: unknown) => void

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function ask(message: string, detail?: string): Promise<boolean> {
  if (process.platform === 'darwin') app.focus({ steal: true })
  const { response } = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Sí', 'No'],
    defaultId: 0,
    cancelId: 1,
    message,
    detail
  })
  return response === 0
}

export async function runSupportCheck(check: CheckFn): Promise<RemoteSupport> {
  const support = detectSupport()
  console.log(JSON.stringify({ support }))

  if (process.platform === 'linux') {
    const env = { XDG_SESSION_TYPE: process.env.XDG_SESSION_TYPE, WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY }
    const expected = isWaylandSession(process.env) ? 'unsupported' : 'available'
    check(`estado con la sesión actual: ${expected}`, support.state === expected, { support, env })
    const wayland = evaluateSupport({
      platform: 'linux',
      env: { ...process.env, XDG_SESSION_TYPE: 'wayland', WAYLAND_DISPLAY: 'wayland-0' }
    })
    check('sesión Wayland simulada: unsupported', wayland.state === 'unsupported', wayland)
    return support
  }

  if (process.platform !== 'darwin') {
    check('estado: available', support.state === 'available', support)
    return support
  }

  const granted = (permission: MacPermission): boolean =>
    support.state !== 'missing_permissions' || !support.missing.includes(permission)
  const seen = [
    `Grabación de pantalla: ${granted('screen') ? 'concedido' : 'falta'}`,
    `Accesibilidad: ${granted('accessibility') ? 'concedido' : 'falta'}`,
    `Estado del equipo: ${support.state}`
  ].join('\n')
  check(
    'el estado detectado coincide con Ajustes del Sistema',
    await ask(
      '¿Coincide con lo que ves para Terminal en Ajustes del Sistema > Privacidad y seguridad?',
      `La app ve:\n${seen}`
    ),
    support
  )

  const panes: [MacPermission, string][] = [
    ['screen', 'Grabación de pantalla'],
    ['accessibility', 'Accesibilidad']
  ]
  for (const [permission, name] of panes) {
    await openPermissionSettings(permission)
    await sleep(2500)
    check(
      `abre el panel de ${name}`,
      await ask(`¿Se ha abierto el panel "${name}" de Ajustes del Sistema?`),
      { permission }
    )
  }

  notifyMissingPermissions(['screen', 'accessibility'], { language: 'es' })
  await sleep(3000)
  check(
    'notificación de permisos perdidos',
    await ask(
      '¿Has visto una notificación sobre los permisos de Grabación de pantalla y Accesibilidad?',
      'Lanzada desde Terminal, la notificación sale a nombre de Electron. Si macOS ha preguntado antes si Electron puede enviar notificaciones, responde según si al final la has visto.'
    ),
    {}
  )
  return support
}

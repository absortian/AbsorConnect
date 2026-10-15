import { describe, it, expect } from 'vitest'
import {
  evaluateSupport,
  isWaylandSession,
  MacPermission,
  missingPermissionsMessage,
  RemoteSupport,
  SupportMonitor
} from '../support'

describe('evaluateSupport', () => {
  it('Windows siempre está disponible', () => {
    expect(evaluateSupport({ platform: 'win32', env: {} })).toEqual({ state: 'available' })
  })

  it('un Mac sin permisos queda en missing_permissions con los que faltan', () => {
    expect(evaluateSupport({ platform: 'darwin', env: {} })).toEqual({
      state: 'missing_permissions',
      missing: ['screen', 'accessibility']
    })
    expect(
      evaluateSupport({
        platform: 'darwin',
        env: {},
        screenGranted: true,
        accessibilityTrusted: false
      })
    ).toEqual({ state: 'missing_permissions', missing: ['accessibility'] })
    expect(
      evaluateSupport({
        platform: 'darwin',
        env: {},
        screenGranted: true,
        accessibilityTrusted: true
      })
    ).toEqual({ state: 'available' })
  })

  it('una sesión Wayland queda en unsupported; X11 está disponible', () => {
    expect(
      evaluateSupport({
        platform: 'linux',
        env: { XDG_SESSION_TYPE: 'wayland', WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':0' }
      })
    ).toEqual({ state: 'unsupported', reason: 'wayland' })
    expect(
      evaluateSupport({ platform: 'linux', env: { XDG_SESSION_TYPE: 'x11', DISPLAY: ':0' } })
    ).toEqual({
      state: 'available'
    })
  })

  it('otros sistemas no están soportados', () => {
    expect(evaluateSupport({ platform: 'freebsd', env: {} })).toEqual({
      state: 'unsupported',
      reason: 'platform'
    })
  })
})

describe('isWaylandSession', () => {
  it('manda XDG_SESSION_TYPE; sin él, WAYLAND_DISPLAY', () => {
    expect(isWaylandSession({ XDG_SESSION_TYPE: 'Wayland' })).toBe(true)
    expect(isWaylandSession({ XDG_SESSION_TYPE: 'x11', WAYLAND_DISPLAY: 'wayland-0' })).toBe(false)
    expect(isWaylandSession({ WAYLAND_DISPLAY: 'wayland-0' })).toBe(true)
    expect(isWaylandSession({ DISPLAY: ':0' })).toBe(false)
    expect(isWaylandSession({ XDG_SESSION_TYPE: 'tty', WAYLAND_DISPLAY: '' })).toBe(false)
  })
})

describe('missingPermissionsMessage', () => {
  it('dice qué permiso hay que volver a conceder, en el idioma de la app', () => {
    expect(missingPermissionsMessage(['screen'], 'es')).toContain(
      'el permiso de Grabación de pantalla'
    )
    expect(missingPermissionsMessage(['screen', 'accessibility'], 'es')).toContain(
      'los permisos de Grabación de pantalla y Accesibilidad'
    )
    expect(missingPermissionsMessage(['accessibility'], 'en')).toContain(
      'needs the Accessibility permission again'
    )
    expect(missingPermissionsMessage(['screen', 'accessibility'], 'fr')).toContain(
      'Screen Recording and Accessibility permissions'
    )
  })
})

describe('SupportMonitor', () => {
  function monitorWith(states: RemoteSupport[]): {
    monitor: SupportMonitor
    notified: MacPermission[][]
    changes: RemoteSupport[]
  } {
    const notified: MacPermission[][] = []
    const changes: RemoteSupport[] = []
    let i = 0
    const monitor = new SupportMonitor({
      detect: () => states[Math.min(i++, states.length - 1)],
      notifyMissing: (missing) => notified.push(missing),
      onChange: (support) => changes.push(support)
    })
    return { monitor, notified, changes }
  }

  const ok: RemoteSupport = { state: 'available' }
  const noScreen: RemoteSupport = { state: 'missing_permissions', missing: ['screen'] }
  const noneGranted: RemoteSupport = {
    state: 'missing_permissions',
    missing: ['screen', 'accessibility']
  }

  it('avisa al perder un permiso y no repite mientras siga faltando', () => {
    const { monitor, notified, changes } = monitorWith([ok, noScreen, noScreen, noScreen])
    monitor.check()
    monitor.check()
    monitor.check()
    monitor.check()
    expect(notified).toEqual([['screen']])
    expect(changes).toEqual([ok, noScreen])
  })

  it('avisa otra vez si se pierde otro permiso, con todos los que faltan', () => {
    const { monitor, notified } = monitorWith([noScreen, noneGranted])
    monitor.check()
    monitor.check()
    expect(notified).toEqual([['screen'], ['screen', 'accessibility']])
  })

  it('vuelve a avisar si se recupera y se pierde de nuevo (otra actualización)', () => {
    const { monitor, notified } = monitorWith([noScreen, ok, noScreen])
    monitor.check()
    monitor.check()
    monitor.check()
    expect(notified).toEqual([['screen'], ['screen']])
  })

  it('en modo silencioso (Ajustes) no notifica, y lo que vio ya no se notifica después', () => {
    const { monitor, notified } = monitorWith([noScreen, noScreen])
    expect(monitor.check({ quiet: true })).toEqual(noScreen)
    monitor.check()
    expect(notified).toEqual([])
  })

  it('current() devuelve el último estado sin volver a mirar', () => {
    const { monitor, changes } = monitorWith([noScreen, ok])
    expect(monitor.current()).toEqual(noScreen)
    expect(monitor.current()).toEqual(noScreen)
    expect(changes).toEqual([noScreen])
  })
})

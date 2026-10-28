import { beforeEach, expect, it, vi } from 'vitest'
import { absentLocalAgent } from '../../shared/remote/localAgent'
const h = vi.hoisted(() => ({
  language: 'es',
  menu: [] as Array<{ label?: string; click?: () => void }>,
  quit: vi.fn()
}))
vi.mock('../../resources/icon.png?asset', () => ({ default: '/icon' }))
vi.mock('../../resources/trayTemplate.png?asset', () => ({ default: '/tray' }))
vi.mock('../store', () => ({
  getLanguage: async () => h.language,
  getBackgroundSettings: async () => ({ keepInBackground: false, openAtLogin: false }),
  saveBackgroundSettings: vi.fn()
}))
vi.mock('electron', () => ({
  app: { getPath: () => '/test', quit: h.quit },
  Menu: {
    buildFromTemplate: (items: typeof h.menu) => {
      h.menu = items
      return items
    }
  },
  nativeImage: { createFromPath: () => ({ setTemplateImage: vi.fn(), isEmpty: () => false }) },
  Tray: class {
    on = vi.fn()
    setToolTip = vi.fn()
    setContextMenu = vi.fn()
  }
}))
beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  h.language = 'es'
  h.menu = []
})
it('la propiedad comienza sin resolver y el modo de usuario mantiene su salida y estado', async () => {
  const b = await import('../background')
  expect(b.isRemoteOwnershipResolved()).toBe(false)
  b.setLocalAgentState(absentLocalAgent())
  expect(b.isRemoteOwnershipResolved()).toBe(true)
  expect(b.isAgentHostOwned()).toBe(false)
  b.setRemoteStatus('available')
  await b.initTray()
  expect(h.menu.map((x) => x.label)).toContain('Control remoto: disponible')
  expect(h.menu.at(-1)?.label).toBe('Salir')
})
it.each(['idle', 'active', 'validation_required', 'revoked'] as const)(
  'la bandeja muestra el estado nativo %s y salir solo cierra la interfaz',
  async (state) => {
    const b = await import('../background')
    b.setLocalAgentState({
      ...absentLocalAgent(),
      ownership: 'agent',
      phase: 'responding',
      state,
      active: state === 'active'
    })
    await b.initTray()
    expect(h.menu.some((x) => x.label?.startsWith('Servicio nativo:'))).toBe(true)
    expect(h.menu.some((x) => x.label?.includes('estado sin verificar'))).toBe(false)
    expect(b.isAgentHostOwned()).toBe(true)
    expect(h.menu.at(-1)?.label).toBe('Salir de la interfaz')
    h.menu.at(-1)?.click?.()
    expect(h.quit).toHaveBeenCalledOnce()
    expect(b.isAgentHostOwned()).toBe(true)
  }
)
it('la salud ambigua no promete disponibilidad y la actualización queda pospuesta', async () => {
  const b = await import('../background')
  b.setLocalAgentState({ ...absentLocalAgent(), ownership: 'unknown', phase: 'unverified' })
  await b.initTray()
  b.setTrayUpdate({ version: '1.2.3' })
  await vi.waitFor(() =>
    expect(
      h.menu.some((x) => x.label?.includes('actualización conjunta app/agente pendiente'))
    ).toBe(true)
  )
  expect(h.menu.map((x) => x.label)).toContain('Servicio nativo: estado sin verificar')
})
it('la traducción inglesa conserva la distinción entre salir y detener el servicio', async () => {
  h.language = 'en'
  const b = await import('../background')
  b.setLocalAgentState({
    ...absentLocalAgent(),
    ownership: 'agent',
    phase: 'responding',
    state: 'active',
    active: true
  })
  await b.initTray()
  expect(h.menu.map((x) => x.label)).toContain('Native service: active session; not certified')
  expect(h.menu.at(-1)?.label).toBe('Quit the interface')
})

it('no anuncia instalación al salir antes de comprobar la propiedad al arrancar', async () => {
  const b = await import('../background')
  await b.initTray()
  b.setTrayUpdate({ version: '1.2.3' })
  await vi.waitFor(() =>
    expect(h.menu.some((x) => x.label?.includes('comprobando el propietario del host'))).toBe(true)
  )
  expect(h.menu.some((x) => x.label?.includes('Instalar la versión'))).toBe(false)
})

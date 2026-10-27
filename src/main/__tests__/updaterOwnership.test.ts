import { beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ owned: false, active: false }))
const updater = vi.hoisted(() => ({
  autoDownload: true,
  autoInstallOnAppQuit: true,
  on: vi.fn(),
  quitAndInstall: vi.fn()
}))
vi.mock('electron-updater', () => ({ autoUpdater: updater }))
vi.mock('electron', () => ({ Notification: class {} }))
vi.mock('../background', () => ({
  getMainWindow: () => null,
  isAgentHostOwned: () => state.owned,
  isRemoteControlActive: () => state.active,
  setTrayUpdate: vi.fn(),
  showMainWindow: vi.fn()
}))
import { initUpdater, quitAndInstall, refreshAgentUpdateGuard } from '../updater'
beforeEach(() => {
  state.owned = false
  state.active = false
  updater.quitAndInstall.mockClear()
})
describe('actualizador y propiedad nativa', () => {
  it('el legado conserva la instalación al salir y el bloqueo durante su sesión', () => {
    initUpdater()
    expect(updater.autoInstallOnAppQuit).toBe(true)
    state.active = true
    expect(quitAndInstall()).toBe(false)
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
    state.active = false
    expect(quitAndInstall()).toBe(true)
    expect(updater.quitAndInstall).toHaveBeenCalledOnce()
  })
  it('no instala al salir ni reinicia la app mientras la salud del agente no esté disponible', () => {
    state.owned = true
    initUpdater()
    expect(updater.autoInstallOnAppQuit).toBe(false)
    expect(quitAndInstall()).toBe(false)
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
  })
  it('el cambio de propietario posterior al arranque desactiva la instalación automática', () => {
    initUpdater()
    state.owned = true
    refreshAgentUpdateGuard()
    expect(updater.autoInstallOnAppQuit).toBe(false)
  })
})

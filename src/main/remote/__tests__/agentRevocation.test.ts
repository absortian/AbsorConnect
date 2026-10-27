import { describe, expect, it, vi } from 'vitest'
import { revokeAccountAgent } from '../agentRevocation'
import type { AgentRevocationDeps } from '../agentRevocation'
import type { AccountDevice } from '../../../shared/remote/viewerBridge'
const id = '12345678-1234-4abc-8def-123456789abc'
const other = '12345678-1234-4abc-8def-123456789abd'
const device: AccountDevice = {
  id,
  name: 'VM prueba',
  platform: 'linux',
  appVersion: '0.4.1',
  online: true,
  lastSeenAt: '',
  self: false,
  remote: {
    state: 'available',
    features: { clipboard: false, files: false, audio: false },
    mode: 'agent',
    agentVersion: '0.1.0',
    capabilities: { administration: false, login: false, secureAttention: false, restart: false }
  }
}
function deps(): AgentRevocationDeps {
  const account = {}
  return {
    account: () => account,
    devices: vi.fn(async () => [device]),
    confirm: vi.fn(async () => true),
    revoke: vi.fn(async () => {}),
    closeViewers: vi.fn()
  }
}
describe('revocación desde Equipos', () => {
  it('confirma el destino de la API, revoca una vez y solo cierra sus visores', async () => {
    const d = deps()
    expect(await revokeAccountAgent(id, d)).toEqual({ ok: true })
    expect(d.confirm).toHaveBeenCalledWith(device)
    expect(d.revoke).toHaveBeenCalledExactlyOnceWith(id)
    expect(d.closeViewers).toHaveBeenCalledExactlyOnceWith(id)
  })
  it('cancelar no toca servicio ni ventanas', async () => {
    const d = deps()
    d.confirm = async () => false
    expect(await revokeAccountAgent(id, d)).toEqual({ ok: false, code: 'cancelled' })
    expect(d.revoke).not.toHaveBeenCalled()
    expect(d.closeViewers).not.toHaveBeenCalled()
  })
  it('un cambio de cuenta durante el diálogo impide la baja', async () => {
    const d = deps()
    d.confirm = async () => {
      d.account = () => ({})
      return true
    }
    expect(await revokeAccountAgent(id, d)).toEqual({ ok: false, code: 'unauthenticated' })
    expect(d.revoke).not.toHaveBeenCalled()
  })
  it('rechaza IDs ajenos, inválidos y hosts de usuario antes de confirmar', async () => {
    for (const target of ['../me', other]) {
      const d = deps()
      expect((await revokeAccountAgent(target, d)).ok).toBe(false)
      expect(d.confirm).not.toHaveBeenCalled()
      expect(d.revoke).not.toHaveBeenCalled()
    }
    const d = deps()
    d.devices = async () => [
      { ...device, remote: { state: 'available', features: device.remote.features } }
    ]
    expect((await revokeAccountAgent(id, d)).ok).toBe(false)
    expect(d.revoke).not.toHaveBeenCalled()
  })
  it('un error de API no se presenta como revocación ni cierra otros visores', async () => {
    const d = deps()
    d.revoke = async () => {
      throw new Error('network_error')
    }
    await expect(revokeAccountAgent(id, d)).rejects.toThrow('network_error')
    expect(d.closeViewers).not.toHaveBeenCalled()
  })
})

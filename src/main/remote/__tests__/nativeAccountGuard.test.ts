import { expect, it, vi } from 'vitest'
import { NativeAccountGuard } from '../nativeAccountGuard'
import { absentLocalAgent, type LocalAgentSnapshot } from '../../../shared/remote/localAgent'
const id = '01234567-89ab-4def-8123-456789abcdef'
function fixture(): {
  guard: NativeAccountGuard
  stop: ReturnType<typeof vi.fn>
  reserved: ReturnType<typeof vi.fn>
  set(value: LocalAgentSnapshot): void
  get(): LocalAgentSnapshot
} {
  let state: LocalAgentSnapshot = {
    ...absentLocalAgent(),
    ownership: 'agent',
    deviceId: id,
    phase: 'responding',
    state: 'active',
    active: true
  }
  const stop = vi.fn().mockResolvedValue({ ok: true, freshEnrollmentRequired: true }),
    reserved = vi.fn()
  const guard = new NativeAccountGuard({ snapshot: () => state, stop, reserved })
  return {
    guard,
    stop,
    reserved,
    set: (v: LocalAgentSnapshot) => {
      state = v
    },
    get: () => state
  }
}
it.each(['logout', 'account-password', 'account-switch', 'local-revoke'])(
  '%s corta por el ID ya verificado sin depender de red/sondeo ni elevar',
  async () => {
    const f = fixture()
    expect(await f.guard.cut()).toEqual({ ok: true, freshEnrollmentRequired: true })
    expect(f.stop).toHaveBeenCalledExactlyOnceWith(id)
    expect(f.reserved.mock.calls).toEqual([[false], [true]])
  }
)
it('paradas concurrentes se comparten y una alta posterior del mismo ID vuelve a pararse', async () => {
  const f = fixture()
  let done!: (v: unknown) => void
  f.stop.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        done = resolve
      })
  )
  const a = f.guard.cut(),
    b = f.guard.cut()
  expect(a).toBe(b)
  done({ ok: true, freshEnrollmentRequired: true })
  await a
  f.set({ ...f.get(), state: 'revoked' })
  await f.guard.cut()
  expect(f.stop).toHaveBeenCalledTimes(2)
  f.set({ ...f.get(), state: 'active' })
  await f.guard.cut()
  expect(f.stop).toHaveBeenCalledTimes(3)
})
it('un fallo no afirma parada ni permite reanudar; la siguiente acción reintenta', async () => {
  const f = fixture()
  f.stop.mockRejectedValueOnce(Error('private error'))
  expect(await f.guard.cut()).toEqual({ ok: false, code: 'local_agent_stop_unconfirmed' })
  expect(f.reserved).toHaveBeenCalledExactlyOnceWith(false)
  expect((await f.guard.cut()).ok).toBe(true)
  expect(f.stop).toHaveBeenCalledTimes(2)
})
it('otra máquina, estado sin ID y modo legado no envían ningún comando', async () => {
  const f = fixture()
  await f.guard.cut('00000000-0000-4000-8000-000000000001')
  f.set({ ...f.get(), deviceId: null })
  await f.guard.cut()
  f.set(absentLocalAgent())
  await f.guard.cut()
  expect(f.stop).not.toHaveBeenCalled()
  expect(f.reserved).not.toHaveBeenCalled()
})

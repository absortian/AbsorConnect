import { afterEach, describe, expect, it, vi } from 'vitest'
import { HostActions } from '../hostActions'
import { RestartWait } from '../restartWait'
import type { ViewerAvailabilityResult } from '../viewerBridge'
const id = '12345678-1234-4abc-8def-123456789abc'
const pending = <T>(): { promise: Promise<T>; resolve(value: T): void } => {
  let resolve!: (value: T) => void
  return {
    promise: new Promise<T>((r) => {
      resolve = r
    }),
    resolve: (v) => resolve(v)
  }
}
function fixture(): {
  actions: HostActions
  send: ReturnType<typeof vi.fn>
  active: { value: boolean }
} {
  const active = { value: true },
    send = vi.fn()
  let serial = 0
  const actions = new HostActions({
    active: () => active.value,
    send,
    changed: vi.fn(),
    id: () =>
      serial++ === 0 ? id : `12345678-1234-4abc-8def-${serial.toString(16).padStart(12, '0')}`
  })
  return { actions, send, active }
}
afterEach(() => vi.useRealTimers())
describe('operaciones autenticadas del host', () => {
  it('no manda comandos al legado/no anunciados ni antes de autenticar', async () => {
    const f = fixture(),
      confirm = vi.fn().mockResolvedValue(true)
    expect((await f.actions.run('restart', confirm)).status).toBe('unavailable')
    f.actions.setActions(['restart'])
    f.active.value = false
    expect((await f.actions.run('restart', confirm)).status).toBe('unavailable')
    expect(confirm).not.toHaveBeenCalled()
    expect(f.send).not.toHaveBeenCalled()
  })
  it('cancelación, cambio de contexto y retirada invalidan una confirmación pendiente', async () => {
    const f = fixture()
    f.actions.setActions(['logout'])
    expect((await f.actions.run('logout', async () => false)).status).toBe('cancelled')
    for (const invalidate of [
      () => f.actions.invalidateConfirmation(),
      () => f.actions.setActions([])
    ]) {
      f.actions.setActions(['logout'])
      const choice = pending<boolean>()
      const result = f.actions.run('logout', () => choice.promise)
      invalidate()
      choice.resolve(true)
      expect((await result).status).toBe('unavailable')
    }
    expect(f.send).not.toHaveBeenCalled()
  })
  it('una sola entrega, resultado correlacionado y rechazo sin reintentos', async () => {
    vi.useFakeTimers()
    const f = fixture()
    f.actions.setActions(['restart'])
    const result = f.actions.run('restart', async () => true)
    await Promise.resolve()
    expect(f.send).toHaveBeenCalledTimes(1)
    expect((await f.actions.run('restart', async () => true)).status).toBe('unavailable')
    const rejected = {
      v: 1,
      extension: 1,
      type: 'host-operation-result',
      id,
      action: 'restart',
      status: 'rejected',
      code: 'not_allowed'
    } as const
    expect(f.actions.receive({ ...rejected, action: 'logout' })).toBe(false)
    expect(f.actions.receive({ ...rejected, id: '22345678-1234-4abc-8def-123456789abc' })).toBe(
      false
    )
    expect(f.actions.receive(rejected)).toBe(true)
    expect(await result).toEqual(rejected)
    expect(f.actions.receive(rejected)).toBe(false)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(f.send).toHaveBeenCalledTimes(1)
  })
  it('resultado perdido bloquea otra orden hasta una conexión nueva; caída retira la espera', async () => {
    vi.useFakeTimers()
    const f = fixture()
    f.actions.setActions(['lock'])
    const first = f.actions.run('lock', async () => true)
    await vi.advanceTimersByTimeAsync(15_000)
    expect((await first).status).toBe('timed_out')
    expect(f.actions.state.blocked).toBe(true)
    f.actions.setActions(['lock'])
    expect((await f.actions.run('lock', async () => true)).status).toBe('unavailable')
    f.actions.reset()
    f.actions.setActions(['lock'])
    const second = f.actions.run('lock', async () => true)
    await Promise.resolve()
    f.active.value = false
    f.actions.reset()
    expect((await second).status).toBe('connection_lost')
    expect(f.send).toHaveBeenCalledTimes(2)
  })
  it('la caché de 64 IDs no se desaloja durante la misma conexión', async () => {
    vi.useFakeTimers()
    const f = fixture()
    f.actions.setActions(['lock'])
    for (let n = 0; n < 64; n++) {
      const result = f.actions.run('lock', async () => true)
      await Promise.resolve()
      f.actions.receive({
        v: 1,
        extension: 1,
        type: 'host-operation-result',
        id: f.actions.state.pending!.id,
        action: 'lock',
        status: 'accepted'
      })
      await result
    }
    expect((await f.actions.run('lock', async () => true)).status).toBe('unavailable')
    expect(f.send).toHaveBeenCalledTimes(64)
  })
})
const baseline = '2026-10-28T00:00:00+00:00'
const online: ViewerAvailabilityResult = {
  ok: true,
  online: true,
  available: true,
  lastSeenAt: baseline
}
describe('espera de reinicio separada de recuperación breve', () => {
  it('presencia antigua no es regreso; detecta disponibilidad nueva a los diez segundos', async () => {
    vi.useFakeTimers()
    const start = Date.now(),
      changed = vi.fn()
    const status = vi.fn(
      async (): Promise<ViewerAvailabilityResult> =>
        Date.now() - start >= 10_000
          ? { ...online, lastSeenAt: '2026-10-28T00:00:10+00:00' }
          : online
    )
    const wait = new RestartWait({ status, changed, now: Date.now })
    wait.start(baseline)
    await vi.advanceTimersByTimeAsync(9999)
    expect(wait.state).toBe('waiting')
    await vi.advanceTimersByTimeAsync(1)
    expect(wait.state).toBe('ready')
    expect(status).toHaveBeenCalledTimes(6)
    wait.dispose()
  })
  it('sin red vence en cinco minutos aunque una consulta no responda; descarta su respuesta tardía', async () => {
    vi.useFakeTimers()
    const response = pending<ViewerAvailabilityResult>(),
      status = vi.fn(() => response.promise)
    const wait = new RestartWait({ status, changed: vi.fn(), now: Date.now })
    wait.start(baseline)
    await vi.advanceTimersByTimeAsync(300_000)
    expect(wait.state).toBe('expired')
    expect(status).toHaveBeenCalledTimes(1)
    response.resolve({ ...online, lastSeenAt: '2026-10-28T00:05:01Z' })
    await Promise.resolve()
    expect(wait.state).toBe('expired')
  })
  it('permite cancelar, respeta Retry-After y se detiene al perder cuenta/equipo', async () => {
    vi.useFakeTimers()
    const status = vi.fn().mockResolvedValue({ ok: false, code: 'rate_limited', retryAfter: 20 })
    const wait = new RestartWait({ status, changed: vi.fn(), now: Date.now })
    wait.start(baseline)
    await vi.advanceTimersByTimeAsync(19_999)
    expect(status).toHaveBeenCalledTimes(1)
    wait.cancel()
    await vi.advanceTimersByTimeAsync(300_000)
    expect(wait.state).toBe('cancelled')
    expect(status).toHaveBeenCalledTimes(1)
    status.mockResolvedValue({ ok: false, code: 'device_not_found' })
    wait.start(baseline)
    await Promise.resolve()
    expect(wait.state).toBe('failed')
  })
  it('consulta solo presencia fuera de línea y no solapa respuestas', async () => {
    vi.useFakeTimers()
    const response = pending<ViewerAvailabilityResult>(),
      status = vi.fn(() => response.promise)
    const wait = new RestartWait({ status, changed: vi.fn(), now: Date.now })
    wait.start(baseline)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(status).toHaveBeenCalledTimes(1)
    response.resolve({ ...online, online: false })
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(2000)
    expect(status).toHaveBeenCalledTimes(2)
    expect(wait.state).toBe('waiting')
    wait.dispose()
  })
})

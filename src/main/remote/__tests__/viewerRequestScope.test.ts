import { expect, it, vi } from 'vitest'
import { ViewerRequestScope } from '../viewerRequestScope'
import type { ViewerRequestResult } from '../../../shared/remote/viewerBridge'
it('no consulta solicitudes de otro visor y serializa la creación', async () => {
  const scope = new ViewerRequestScope()
  let finish!: (value: ViewerRequestResult) => void
  const send = vi.fn(
    () =>
      new Promise<ViewerRequestResult>((r) => {
        finish = r
      })
  )
  expect(scope.permits('ajeno')).toBe(false)
  const first = scope.create(() => true, send)
  expect(await scope.create(() => true, send)).toEqual({ ok: false, code: 'busy' })
  finish({ ok: true, id: 'propio' })
  expect((await first).ok).toBe(true)
  expect(scope.permits('propio')).toBe(true)
  expect(scope.permits('ajeno')).toBe(false)
  const second = scope.create(() => true, send)
  expect(scope.permits('propio')).toBe(false)
  finish({ ok: true, id: 'nuevo' })
  await second
  expect(scope.permits('nuevo')).toBe(true)
})
it('una cuenta/ventana invalidada no publica un resultado que llegó tarde', async () => {
  const scope = new ViewerRequestScope()
  let allowed = true
  const result = await scope.create(
    () => allowed,
    async () => {
      allowed = false
      return { ok: true, id: 'anterior' }
    }
  )
  expect(result).toEqual({ ok: false, code: 'forbidden' })
  expect(scope.permits('anterior')).toBe(false)
  const send = vi.fn()
  expect((await scope.create(() => false, send)).ok).toBe(false)
  expect(send).not.toHaveBeenCalled()
})

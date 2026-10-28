import { expect, it, vi } from 'vitest'
import { viewerAvailability, viewerTarget } from '../viewerAvailability'
const id = '12345678-1234-4abc-8def-123456789abc'
const account = {},
  device = {
    id,
    name: 'no se expone',
    online: true,
    lastSeenAt: '2026-10-28T00:00:00Z',
    remote: { state: 'available', credential: 'no se expone' }
  }
it('devuelve solo la presencia del destino fijado por main', async () => {
  const result = await viewerAvailability(id, {
    account: () => account,
    allowed: () => true,
    devices: async () => ({ devices: [{ ...device, id: 'otro' }, device] })
  })
  expect(result).toEqual({ ok: true, online: true, available: true, lastSeenAt: device.lastSeenAt })
})
it('deniega otro remitente, una cuenta cambiada y presencia ambigua o inválida', async () => {
  const read = vi.fn(async () => ({ devices: [device] }))
  expect(
    await viewerAvailability(id, { account: () => account, allowed: () => false, devices: read })
  ).toEqual({ ok: false, code: 'forbidden' })
  expect(read).not.toHaveBeenCalled()
  let current: object = account
  expect(
    await viewerAvailability(id, {
      account: () => current,
      allowed: () => true,
      devices: async () => {
        current = {}
        return { devices: [device] }
      }
    })
  ).toEqual({ ok: false, code: 'unauthenticated' })
  for (const devices of [
    [device, device],
    [],
    [{ ...device, lastSeenAt: 'invalid' }],
    [{ ...device, online: 'true' }]
  ]) {
    expect(
      (
        await viewerAvailability(id, {
          account: () => account,
          allowed: () => true,
          devices: async () => ({ devices })
        })
      ).ok
    ).toBe(false)
  }
})

it('el nombre mostrado procede del equipo propio autorizado, nunca de un parámetro del renderer', async () => {
  const options = {
    account: () => account,
    allowed: () => true,
    devices: async () => ({ devices: [device] })
  }
  expect(await viewerTarget(id, options)).toEqual({ id, name: device.name })
  expect(await viewerTarget('../otro', options)).toBeNull()
  expect(
    await viewerTarget(id, {
      ...options,
      devices: async () => ({ devices: [{ ...device, name: '' }] })
    })
  ).toBeNull()
})

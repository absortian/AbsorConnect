import { expect, it, vi } from 'vitest'
import { AgentControlClient, parseStopReply } from '../agentControlClient'
const DEVICE = '12345678-1234-4abc-8def-123456789abc'
const reply = (): string =>
  JSON.stringify({
    v: 1,
    nonce: '01'.repeat(16),
    deviceId: DEVICE,
    stopped: true,
    freshEnrollmentRequired: true
  })
it('solo confirma una parada ligada al equipo exacto y sin ampliar el contrato', () => {
  expect(parseStopReply(reply(), DEVICE)).toBe(true)
  const base = JSON.parse(reply())
  for (const edit of [
    { v: 2 },
    { stopped: false },
    { freshEnrollmentRequired: false },
    { token: 'secret' },
    { key: 'secret' },
    { nonce: 'bad' },
    { deviceId: '22345678-1234-4abc-8def-123456789abc' }
  ])
    expect(parseStopReply(JSON.stringify({ ...base, ...edit }), DEVICE)).toBe(false)
  expect(parseStopReply(reply().replace('{', '{"v":1,'), DEVICE)).toBe(false)
  expect(parseStopReply(' '.repeat(513), DEVICE)).toBe(false)
})
it('la interfaz solo recibe confirmación, sin nonce ni información del proceso', async () => {
  const source = { available: vi.fn(async () => true), stop: vi.fn(async () => reply()) }
  const client = new AgentControlClient(source)
  expect(await client.stop(DEVICE)).toEqual({ ok: true, freshEnrollmentRequired: true })
  expect(source.stop).toHaveBeenCalledExactlyOnceWith(DEVICE)
})
it('no sustituye un equipo inválido ni permite dos paradas simultáneas', async () => {
  let complete!: (raw: string) => void
  const source = {
    available: vi.fn(async () => true),
    stop: vi.fn(
      () =>
        new Promise<string>((resolve) => {
          complete = resolve
        })
    )
  }
  const client = new AgentControlClient(source)
  expect(await client.stop('invalid')).toEqual({ ok: false, code: 'local_agent_unverified' })
  expect(source.available).not.toHaveBeenCalled()
  const pending = client.stop(DEVICE)
  await vi.waitFor(() => expect(source.stop).toHaveBeenCalledOnce())
  expect(await client.stop(DEVICE)).toEqual({ ok: false, code: 'local_agent_busy' })
  complete(reply())
  expect(await pending).toEqual({ ok: true, freshEnrollmentRequired: true })
})
it('ausencia, fallo del helper y respuesta inválida no se presentan como parada confirmada', async () => {
  const source = {
    available: vi.fn(async () => false),
    stop: vi.fn(async (): Promise<string> => {
      throw Error('private-token-detail')
    })
  }
  const client = new AgentControlClient(source)
  expect(await client.stop(DEVICE)).toEqual({ ok: false, code: 'local_agent_control_unavailable' })
  expect(source.stop).not.toHaveBeenCalled()
  source.available.mockResolvedValue(true)
  expect(await client.stop(DEVICE)).toEqual({ ok: false, code: 'local_agent_stop_unconfirmed' })
  source.stop.mockResolvedValue('not-json')
  expect(await client.stop(DEVICE)).toEqual({ ok: false, code: 'local_agent_stop_unconfirmed' })
})

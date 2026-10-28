import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentStatusClient, parseLocalAgentStatus } from '../agentStatusClient'
function status(state = 'idle'): string {
  return JSON.stringify({
    v: 1,
    nonce: '01'.repeat(16),
    owner: 'agent',
    deviceId: '01234567-89ab-4def-8123-456789abcdef',
    agentVersion: '0.1.0+secure-lab',
    instance: '02'.repeat(16),
    bootId: '11234567-89ab-4def-8123-456789abcdef',
    pid: 100,
    publishedAtBoottimeMillis: 10,
    state,
    readyForUnattended: false
  })
}
afterEach(() => {
  vi.useRealTimers()
})
describe('cliente local sin autoridad del trabajador', () => {
  it('entrega solo identidad pública/estado y nunca transforma una declaración en certificado', () => {
    const value = parseLocalAgentStatus(status('active'))!
    expect(value).toEqual({
      ownership: 'agent',
      phase: 'responding',
      deviceId: '01234567-89ab-4def-8123-456789abcdef',
      agentVersion: '0.1.0+secure-lab',
      state: 'active',
      active: true,
      readyForUnattended: false
    })
    for (const name of [
      'nonce',
      'pid',
      'bootId',
      'instance',
      'credential',
      'token',
      'key',
      'password'
    ])
      expect(value).not.toHaveProperty(name)
  })
  it('rechaza ampliaciones, duplicados, tamaños, versiones, texto y promesas no admitidas', () => {
    const base = JSON.parse(status())
    for (const edit of [
      { token: 'untrusted' },
      { owner: 'user' },
      { v: 2 },
      { pid: -1 },
      { state: 'shell' },
      { deviceId: 'not-a-device' },
      { agentVersion: 'secret\ntext' },
      { publishedAtBoottimeMillis: Number.MAX_SAFE_INTEGER + 1 },
      { readyForUnattended: true }
    ])
      expect(parseLocalAgentStatus(JSON.stringify({ ...base, ...edit }))).toBeNull()
    expect(parseLocalAgentStatus(status().replace('{', '{"v":1,'))).toBeNull()
    expect(parseLocalAgentStatus(' '.repeat(513))).toBeNull()
    expect(parseLocalAgentStatus(' ' + status())).toBeNull()
  })
  it('no ejecuta el cliente antes de que exista intención nativa y conserva la propiedad tras perderlo', async () => {
    let installed = false
    const query = vi.fn(async () => status('active'))
    const client = new AgentStatusClient({
      presence: async () => (installed ? 'installed' : 'absent'),
      query
    })
    expect((await client.read()).ownership).toBe('legacy')
    expect(query).not.toHaveBeenCalled()
    installed = true
    expect((await client.read()).active).toBe(true)
    installed = false
    expect(await client.read()).toMatchObject({
      ownership: 'agent',
      phase: 'unverified',
      active: false
    })
    expect(query).toHaveBeenCalledTimes(1)
    client.close()
  })
  it('una instalación o lectura ambigua bloquea el retorno automático al legado', async () => {
    let fault = true
    const client = new AgentStatusClient({
      presence: async () => {
        if (fault) throw Error('private detail')
        return 'absent'
      },
      query: async () => {
        throw Error('must not execute')
      }
    })
    expect(await client.read()).toMatchObject({ ownership: 'unknown', phase: 'unverified' })
    fault = false
    expect((await client.read()).ownership).toBe('unknown')
    expect(JSON.stringify(client.current())).not.toContain('private detail')
    client.close()
  })
  it('cerrar cancela únicamente la consulta y descarta la respuesta tardía', async () => {
    let complete!: (value: string) => void
    let signal: AbortSignal | undefined
    const query = vi.fn((value: AbortSignal) => {
      signal = value
      return new Promise<string>((r) => {
        complete = r
      })
    })
    const client = new AgentStatusClient({ presence: async () => 'installed', query })
    const pending = client.read()
    await Promise.resolve()
    expect(query).toHaveBeenCalledTimes(1)
    client.close()
    expect(signal?.aborted).toBe(true)
    complete(status('active'))
    expect(await pending).toMatchObject({
      ownership: 'unknown',
      phase: 'unverified',
      active: false
    })
    expect((await client.read()).active).toBe(false)
    expect(query).toHaveBeenCalledTimes(1)
  })
  it('coalesce lecturas y no duplica observadores al renovar ni después de cerrar', async () => {
    vi.useFakeTimers()
    const query = vi.fn(async () => status())
    const client = new AgentStatusClient({ presence: async () => 'installed', query })
    const a = client.read()
    const b = client.read()
    expect(a).toBe(b)
    await a
    const callback = vi.fn()
    const duplicate = vi.fn()
    client.watch(callback)
    client.watch(duplicate)
    await vi.advanceTimersByTimeAsync(3000)
    expect(callback).toHaveBeenCalledTimes(3)
    expect(duplicate).not.toHaveBeenCalled()
    client.close()
    await vi.advanceTimersByTimeAsync(3000)
    expect(callback).toHaveBeenCalledTimes(3)
    expect(client.current()).toMatchObject({
      ownership: 'agent',
      phase: 'unverified',
      active: false
    })
  })
})

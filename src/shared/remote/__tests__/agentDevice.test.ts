import { describe, expect, it } from 'vitest'
import { isDeviceId, parseAgentDeviceInfo, travelReadiness } from '../agentDevice'
const capabilities = { administration: true, login: true, secureAttention: false, restart: true }
const native = { mode: 'agent', agentVersion: '0.1.0+vm', capabilities }
describe('identidad declarada del host', () => {
  it('conserva hosts anteriores y nunca confunde declaración con certificación', () => {
    expect(parseAgentDeviceInfo({ state: 'available' })).toEqual({ mode: 'legacy' })
    const agent = parseAgentDeviceInfo(native)
    expect(agent).toEqual({ mode: 'agent', agentVersion: native.agentVersion, capabilities })
    expect(travelReadiness(agent, true)).toBe('not_certified')
    expect(travelReadiness(agent, false)).toBe('offline')
    expect(travelReadiness({ mode: 'legacy' }, true)).toBe('legacy_session')
    expect(travelReadiness({ mode: 'unknown' }, true)).toBe('unknown')
  })
  it.each([
    null,
    [],
    { mode: 'future' },
    { ...native, agentVersion: 'bad\n' },
    { ...native, capabilities: { ...capabilities, root: true } },
    { ...native, capabilities: { ...capabilities, login: 1 } },
    { ...native, capabilities: { restart: true } }
  ])('cierra permisos con metadatos inválidos %j', (value) => {
    expect(parseAgentDeviceInfo(value)).toEqual({ mode: 'unknown' })
  })
  it('un identificador no puede convertirse en otra ruta de la API', () => {
    expect(isDeviceId('12345678-1234-4abc-8def-123456789abc')).toBe(true)
    for (const id of [
      null,
      '../me',
      '12345678-1234-4abc-8def-123456789abc/../connections',
      '12345678-1234-4abc-8def-123456789abc\n'
    ])
      expect(isDeviceId(id)).toBe(false)
  })
})

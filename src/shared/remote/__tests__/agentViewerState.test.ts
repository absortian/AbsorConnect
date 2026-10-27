import { describe, expect, it } from 'vitest'
import { AgentViewerState } from '../agentViewerState'

const caps = {
  v: 1,
  extension: 1,
  type: 'agent-capabilities',
  agentVersion: '0.1.0',
  actions: [],
  capabilities: { administration: false, login: false, secureAttention: false, restart: false }
}
const context = (sequence: number, state = 'user_desktop', imageAvailable = true): string =>
  JSON.stringify({ v: 1, extension: 1, type: 'agent-context', sequence, state, imageAvailable })

describe('aislamiento del contexto del controlador', () => {
  it('no negocia con legado, versiones desconocidas o mensajes no anunciados', () => {
    const s = new AgentViewerState()
    expect(s.accept(JSON.stringify(caps))).toBe(false)
    expect(s.accept(context(1))).toBe(false)
    expect(s.announce(2, true)).toBe(false)
    expect(s.announce(1, false)).toBe(false)
    expect(s.status).toMatchObject({ enabled: false, inputAllowed: true, sensitiveAllowed: true })
  })
  it('espera capacidades y contexto; ignora repeticiones y estados inválidos', () => {
    const s = new AgentViewerState()
    expect(s.announce(1, true)).toBe(true)
    expect(s.announce(1, true)).toBe(false)
    expect(s.status).toMatchObject({ imageAvailable: false, sensitiveAllowed: false })
    expect(s.accept(context(1))).toBe(true)
    expect(s.status.inputAllowed).toBe(false)
    expect(s.accept(JSON.stringify(caps))).toBe(true)
    expect(s.status).toMatchObject({
      imageAvailable: true,
      inputAllowed: true,
      sensitiveAllowed: true
    })
    expect(s.accept(JSON.stringify(caps))).toBe(false)
    expect(s.accept(context(1, 'locked'))).toBe(false)
    expect(s.accept(context(2, 'transition', true))).toBe(false)
    expect(s.status.state).toBe('user_desktop')
  })
  it('protege transición y credenciales; contenido sensible solo vuelve con conexión nueva', () => {
    const s = new AgentViewerState()
    s.announce(1, true)
    s.accept(
      JSON.stringify({
        ...caps,
        capabilities: { ...caps.capabilities, login: true, administration: true }
      })
    )
    s.accept(context(1))
    s.accept(context(2, 'transition', false))
    expect(s.status).toMatchObject({
      imageAvailable: false,
      inputAllowed: false,
      sensitiveAllowed: false
    })
    s.accept(context(3, 'secure_prompt'))
    expect(s.status).toMatchObject({
      imageAvailable: true,
      inputAllowed: true,
      sensitiveAllowed: false
    })
    expect(s.accept(context(2))).toBe(false)
    s.accept(context(4))
    expect(s.status.sensitiveAllowed).toBe(false)
    const fresh = new AgentViewerState()
    fresh.announce(1, true)
    expect(fresh.status.imageAvailable).toBe(false)
    fresh.accept(JSON.stringify(caps))
    fresh.accept(context(1))
    expect(fresh.status.sensitiveAllowed).toBe(true)
  })
})

it('una imagen protegida sin capacidad declarada no permite entrada', () => {
  const s = new AgentViewerState()
  s.announce(1, true)
  s.accept(JSON.stringify(caps))
  s.accept(context(1, 'login'))
  expect(s.status).toMatchObject({
    imageAvailable: true,
    inputAllowed: false,
    sensitiveAllowed: false
  })
  s.accept(context(2, 'secure_prompt'))
  expect(s.status.inputAllowed).toBe(false)
})

it('la retirada posterior de una capacidad corta entrada en el contexto actual', () => {
  const s = new AgentViewerState()
  s.announce(1, true)
  s.accept(JSON.stringify({ ...caps, capabilities: { ...caps.capabilities, login: true } }))
  s.accept(context(1, 'locked'))
  expect(s.status.inputAllowed).toBe(true)
  expect(s.accept(JSON.stringify(caps))).toBe(true)
  expect(s.status.inputAllowed).toBe(false)
})

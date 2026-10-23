import { describe, expect, it } from 'vitest'
import {
  AGENT_CONTROL_LIMIT,
  parseAgentControllerMessage,
  parseAgentHostMessage
} from '../agentProtocol'
import { parseControllerMessage } from '../protocol'
import vectors from '../agent-protocol-vectors.json'

describe('contrato administrativo opcional compartido con Dart', () => {
  for (const vector of vectors.valid) {
    it(`acepta y reconstruye ${vector.name}`, () => {
      const parse =
        vector.direction === 'host' ? parseAgentHostMessage : parseAgentControllerMessage
      expect(parse(JSON.stringify(vector.message))).toEqual(vector.message)
    })
  }
  for (const vector of vectors.invalid) {
    it(`rechaza ${vector.name}`, () => {
      const parse =
        vector.direction === 'host' ? parseAgentHostMessage : parseAgentControllerMessage
      expect(parse(JSON.stringify(vector.message))).toBeNull()
    })
  }
  it('limita bytes y rechaza JSON roto o mensajes de la otra dirección', () => {
    const controller = JSON.stringify(
      vectors.valid.find((v) => v.direction === 'controller')!.message
    )
    const host = JSON.stringify(vectors.valid.find((v) => v.direction === 'host')!.message)
    expect(parseAgentControllerMessage(controller.padEnd(AGENT_CONTROL_LIMIT))).not.toBeNull()
    expect(parseAgentControllerMessage(controller.padEnd(AGENT_CONTROL_LIMIT + 1))).toBeNull()
    expect(parseAgentHostMessage(host.padEnd(AGENT_CONTROL_LIMIT + 1))).toBeNull()
    for (const raw of ['', '{', 'null', '[]', 'true']) {
      expect(parseAgentControllerMessage(raw)).toBeNull()
      expect(parseAgentHostMessage(raw)).toBeNull()
    }
    expect(parseAgentControllerMessage(host)).toBeNull()
    expect(parseAgentHostMessage(controller)).toBeNull()
  })
  it('el analizador legado sigue ignorando órdenes administrativas', () => {
    for (const vector of vectors.valid.filter((v) => v.direction === 'controller')) {
      expect(parseControllerMessage(JSON.stringify(vector.message))).toBeNull()
    }
    expect(
      parseControllerMessage('{"v":1,"type":"set-stream-quality","profile":"smooth"}')
    ).toEqual({ v: 1, type: 'set-stream-quality', profile: 'smooth' })
    expect(parseControllerMessage('{"v":1,"type":"auth","proof":"public-test"}')).toEqual({
      v: 1,
      type: 'auth',
      proof: 'public-test'
    })
  })
})

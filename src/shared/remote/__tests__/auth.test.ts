import { describe, it, expect } from 'vitest'
import { computeProof, constantTimeEqual, ProofInput, verifyProof } from '../auth'
import { deriveKey } from '../../../main/remote/password'
import vectorsFile from '../auth-vectors.json'

const input = (v: (typeof vectorsFile.vectors)[number]): ProofInput => ({
  nonce: v.nonce,
  offerFingerprint: v.offerFingerprint,
  answerFingerprint: v.answerFingerprint
})
const keyOf = (v: (typeof vectorsFile.vectors)[number]): Uint8Array =>
  new Uint8Array(Buffer.from(v.key, 'base64'))

describe('auth — vectores', () => {
  it('WebCrypto coincide con los vectores (generados con node:crypto)', async () => {
    for (const v of vectorsFile.vectors) {
      expect(await computeProof(keyOf(v), input(v)), v.note).toBe(v.proof)
    }
  })

  it('la cadena completa: PBKDF2(contraseña) da la K del vector', () => {
    const full = vectorsFile.vectors.find((v) => 'password' in v)!
    const derived = deriveKey(full.password as string, {
      salt: full.salt as string,
      iterations: full.iterations as number
    })
    expect(derived.toString('base64')).toBe(full.key)
  })

  it('verifyProof acepta la prueba correcta y rechaza una alterada', async () => {
    const v = vectorsFile.vectors[0]
    expect(await verifyProof(keyOf(v), input(v), v.proof)).toBe(true)
    const tampered = v.proof.slice(0, -2) + (v.proof.endsWith('A') ? 'BB' : 'AA')
    expect(await verifyProof(keyOf(v), input(v), tampered)).toBe(false)
  })
})

describe('auth — la prueba está atada a la conexión', () => {
  const base = vectorsFile.vectors[0]
  const key = keyOf(base)

  it('cambiar la huella de la oferta cambia la prueba', async () => {
    const changed = await computeProof(key, {
      ...input(base),
      offerFingerprint: base.answerFingerprint
    })
    expect(changed).not.toBe(base.proof)
  })

  it('cambiar la huella de la respuesta cambia la prueba', async () => {
    const changed = await computeProof(key, {
      ...input(base),
      answerFingerprint: base.offerFingerprint
    })
    expect(changed).not.toBe(base.proof)
  })

  it('cambiar el nonce cambia la prueba', async () => {
    const changed = await computeProof(key, {
      ...input(base),
      nonce: Buffer.from('otro-nonce').toString('base64')
    })
    expect(changed).not.toBe(base.proof)
  })

  it('una K distinta no verifica', async () => {
    const otherKey = new Uint8Array(32).fill(7)
    expect(await verifyProof(otherKey, input(base), base.proof)).toBe(false)
  })
})

describe('constantTimeEqual', () => {
  it('compara por contenido y longitud', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true)
    expect(constantTimeEqual('abc', 'abd')).toBe(false)
    expect(constantTimeEqual('abc', 'ab')).toBe(false)
  })
})

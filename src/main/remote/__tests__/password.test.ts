import { describe, it, expect } from 'vitest'
import { deriveKey, keysEqual, newPasswordParams, PBKDF2_ITERATIONS } from '../password'

describe('password', () => {
  it('usa 600 000 iteraciones y un salt nuevo cada vez', () => {
    const a = newPasswordParams()
    const b = newPasswordParams()
    expect(a.iterations).toBe(PBKDF2_ITERATIONS)
    expect(a.salt).not.toBe(b.salt)
  })

  it('deriva la misma K para la misma contraseña y parámetros', () => {
    const params = newPasswordParams()
    expect(
      keysEqual(deriveKey('contraseña-del-pc', params), deriveKey('contraseña-del-pc', params))
    ).toBe(true)
  })

  it('normaliza la contraseña (NFC): misma K escrita de dos formas Unicode', () => {
    const params = newPasswordParams()
    const composed = 'año' // ñ como un solo code point
    const decomposed = 'año' // n + combining tilde
    expect(keysEqual(deriveKey(composed, params), deriveKey(decomposed, params))).toBe(true)
  })

  it('una contraseña distinta da una K distinta', () => {
    const params = newPasswordParams()
    expect(keysEqual(deriveKey('uno', params), deriveKey('dos', params))).toBe(false)
  })

  it('la K mide 32 bytes', () => {
    expect(deriveKey('x', newPasswordParams()).length).toBe(32)
  })
})

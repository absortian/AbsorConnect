import { describe, it, expect } from 'vitest'
import { createHash, randomBytes } from 'crypto'
import { Sha256 } from '../sha256'

const reference = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')

describe('Sha256 por partes', () => {
  it('coincide con los vectores conocidos', () => {
    expect(new Sha256().hex()).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    )
    expect(new Sha256().update(new TextEncoder().encode('abc')).hex()).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    )
  })

  it('da lo mismo que el de Node con cualquier forma de partir los datos', () => {
    for (const size of [1, 55, 56, 63, 64, 65, 119, 120, 1000, 65_536 + 7, 1_048_576]) {
      const data = new Uint8Array(randomBytes(size))
      const hash = new Sha256()
      let offset = 0
      while (offset < size) {
        const step = 1 + Math.floor(Math.random() * 70_000)
        hash.update(data.subarray(offset, offset + step))
        offset += step
      }
      expect(hash.hex()).toBe(reference(data))
    }
  })

  it('no admite más datos después del resumen', () => {
    const hash = new Sha256()
    hash.hex()
    expect(() => hash.update(new Uint8Array(1))).toThrow()
  })
})

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { DeviceIdentity } from '../deviceIdentity'
import { createPlaintextBox } from '../secretBox'

let dir: string
let file: string

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'absor-dev-'))
  file = path.join(dir, 'device.json')
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('DeviceIdentity', () => {
  it('crea una identidad y la conserva entre cargas', async () => {
    const first = await new DeviceIdentity(file, createPlaintextBox()).get()
    const second = await new DeviceIdentity(file, createPlaintextBox()).get()
    expect(second).toEqual(first)
  })

  it('la clave es válida para X-Device-Key (32 bytes en base64url, 32-128 chars)', async () => {
    const { id, key } = await new DeviceIdentity(file, createPlaintextBox()).get()
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    expect(key).toMatch(/^[A-Za-z0-9_-]{32,128}$/)
    expect(Buffer.from(key, 'base64url').length).toBe(32)
  })

  it('dos equipos distintos tienen identificadores y claves distintos', async () => {
    const a = await new DeviceIdentity(path.join(dir, 'a.json'), createPlaintextBox()).get()
    const b = await new DeviceIdentity(path.join(dir, 'b.json'), createPlaintextBox()).get()
    expect(a.id).not.toBe(b.id)
    expect(a.key).not.toBe(b.key)
  })
})

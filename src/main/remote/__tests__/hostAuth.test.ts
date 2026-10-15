import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { computeProof, sdpFingerprint } from '../../../shared/remote/auth'
import { HostAuth } from '../hostAuth'
import { deriveKey } from '../password'
import { RemoteAccessStore } from '../remoteAccessStore'
import { createPlaintextBox } from '../secretBox'

const PASSWORD = 'contraseña-del-pc-secreta'
const OFFER =
  'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\na=fingerprint:sha-256 AA:BB:CC\r\nm=application 9\r\n'
const ANSWER =
  'v=0\r\no=- 3 4 IN IP4 127.0.0.1\r\na=fingerprint:sha-256 DD:EE:FF\r\nm=application 9\r\n'

let dir: string
let store: RemoteAccessStore

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'absor-auth-'))
  store = new RemoteAccessStore(path.join(dir, 'remote-access.json'), createPlaintextBox(), 'PC')
  await store.setPassword(PASSWORD)
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

/** Lo que hace el controlador con el `hello` y las descripciones que ve. */
async function controllerProof(
  auth: HostAuth,
  password: string,
  offer = OFFER,
  answer = ANSWER
): Promise<string> {
  const hello = await auth.hello('PC')
  if (!hello) throw new Error('sin hello')
  const key = deriveKey(password, { salt: hello.salt, iterations: hello.iterations })
  return computeProof(key, {
    nonce: hello.nonce,
    offerFingerprint: sdpFingerprint(offer)!,
    answerFingerprint: sdpFingerprint(answer)!
  })
}

describe('HostAuth', () => {
  it('hello lleva salt, iteraciones y un nonce nuevo por conexión, nunca K ni la contraseña', async () => {
    const a = await new HostAuth(store, OFFER, ANSWER).hello('Sobremesa')
    const b = await new HostAuth(store, OFFER, ANSWER).hello('Sobremesa')
    expect(a).toMatchObject({ v: 1, type: 'hello', hostName: 'Sobremesa', iterations: 600_000 })
    expect(a!.nonce).not.toBe(b!.nonce)
    expect(JSON.stringify(a)).not.toContain(PASSWORD)
    expect(Object.keys(a!).sort()).toEqual(['hostName', 'iterations', 'nonce', 'salt', 'type', 'v'])
  })

  it('la contraseña correcta autentica y reinicia los fallos', async () => {
    await store.registerFailure()
    const auth = new HostAuth(store, OFFER, ANSWER)
    expect(await auth.verify(await controllerProof(auth, PASSWORD))).toEqual({ ok: true })
    expect(await store.lockRemainingSeconds()).toBe(0)
  })

  it('una contraseña incorrecta falla y cuenta como intento; no hay segundo intento', async () => {
    const auth = new HostAuth(store, OFFER, ANSWER)
    expect(await auth.verify(await controllerProof(auth, 'otra-contraseña'))).toEqual({
      ok: false,
      reason: 'wrong_password'
    })
    // Ni con la buena: la conexión ya gastó su intento
    expect(await auth.verify(await controllerProof(auth, PASSWORD))).toEqual({
      ok: false,
      reason: 'wrong_password'
    })
    expect((await store.getLog()).filter((e) => e.type === 'auth-failed')).toHaveLength(1)
  })

  it('si alguien cambia las huellas por el camino, la prueba no coincide', async () => {
    const auth = new HostAuth(store, OFFER, ANSWER)
    const tampered = ANSWER.replace('DD:EE:FF', '11:22:33')
    expect(await auth.verify(await controllerProof(auth, PASSWORD, OFFER, tampered))).toEqual({
      ok: false,
      reason: 'wrong_password'
    })
  })

  it('tras 5 fallos rechaza con el tiempo restante, aunque la contraseña sea correcta', async () => {
    for (let i = 0; i < 5; i++) {
      const auth = new HostAuth(store, OFFER, ANSWER)
      await auth.verify(await controllerProof(auth, `mala-${i}`))
    }
    const auth = new HostAuth(store, OFFER, ANSWER)
    const outcome = await auth.verify(await controllerProof(auth, PASSWORD))
    expect(outcome).toMatchObject({ ok: false, reason: 'locked' })
    expect(
      outcome.ok === false && outcome.reason === 'locked' && outcome.retryAfter
    ).toBeGreaterThan(890)
  })

  it('una prueba que no es texto no autentica', async () => {
    const auth = new HostAuth(store, OFFER, ANSWER)
    await auth.hello('PC')
    expect(await auth.verify({ proof: 'x' })).toEqual({ ok: false, reason: 'wrong_password' })
  })
})

describe('sdpFingerprint', () => {
  it('toma la primera línea a=fingerprint, con CRLF o LF', () => {
    expect(sdpFingerprint(OFFER)).toBe('sha-256 AA:BB:CC')
    expect(sdpFingerprint('v=0\na=fingerprint: sha-256 01:02 \na=fingerprint:sha-1 99')).toBe(
      'sha-256 01:02'
    )
    expect(sdpFingerprint('v=0\r\nm=audio 9\r\n')).toBeNull()
  })
})

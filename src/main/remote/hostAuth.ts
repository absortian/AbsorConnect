// Autenticación de una conexión en el PC controlado (add-remote-desktop D6). Vive en el proceso
// principal: K no llega nunca al renderer `host`, que solo reenvía `hello` y `auth`.
//   1. hello(): {salt, iterations, nonce, hostName} para que el controlador derive K.
//   2. verify(proof): una sola prueba por conexión, atada a las huellas DTLS de la oferta y la
//      respuesta. Los fallos y el bloqueo se guardan en el almacén y sobreviven a un reinicio.
import { randomBytes } from 'crypto'
import { sdpFingerprint, verifyProof } from '../../shared/remote/auth'
import { RemoteAccessStore } from './remoteAccessStore'

export interface HostHello {
  v: 1
  type: 'hello'
  salt: string
  iterations: number
  nonce: string
  hostName: string
}

export type AuthOutcome =
  | { ok: true }
  | { ok: false; reason: 'wrong_password' }
  | { ok: false; reason: 'locked'; retryAfter: number }

type AuthStore = Pick<
  RemoteAccessStore,
  | 'getPasswordParams'
  | 'getKey'
  | 'isLocked'
  | 'lockRemainingSeconds'
  | 'registerFailure'
  | 'clearFailures'
>

export class HostAuth {
  private readonly nonce = randomBytes(32).toString('base64')
  private attempted = false

  constructor(
    private readonly store: AuthStore,
    private readonly offer: string,
    private readonly answer: string,
    /** Nombre del equipo que se conecta, para el registro de intentos fallidos. */
    private readonly controller: string | null = null,
    private readonly now: () => number = Date.now
  ) {}

  /** null si el PC no tiene contraseña (no debería llegar aquí: se rechaza antes). */
  async hello(hostName: string): Promise<HostHello | null> {
    const params = await this.store.getPasswordParams()
    if (!params) return null
    return { v: 1, type: 'hello', ...params, nonce: this.nonce, hostName }
  }

  async verify(proof: unknown): Promise<AuthOutcome> {
    const now = this.now()
    if (await this.store.isLocked(now)) {
      return { ok: false, reason: 'locked', retryAfter: await this.store.lockRemainingSeconds(now) }
    }
    // Una conexión, un intento: tras un fallo se cierra (y otra prueba aquí no cuenta)
    if (this.attempted) return { ok: false, reason: 'wrong_password' }
    this.attempted = true

    const key = await this.store.getKey()
    const offerFingerprint = sdpFingerprint(this.offer)
    const answerFingerprint = sdpFingerprint(this.answer)
    const valid =
      key !== null &&
      typeof proof === 'string' &&
      offerFingerprint !== null &&
      answerFingerprint !== null &&
      (await verifyProof(key, { nonce: this.nonce, offerFingerprint, answerFingerprint }, proof))
    if (valid) {
      await this.store.clearFailures()
      return { ok: true }
    }
    await this.store.registerFailure(now, this.controller ?? undefined)
    return { ok: false, reason: 'wrong_password' }
  }
}

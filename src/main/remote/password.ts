// Derivación de la clave de la contraseña del PC (add-remote-desktop D6). La contraseña NUNCA se
// guarda: de ella solo se deriva K = PBKDF2-HMAC-SHA256(contraseña, salt, iterations, 32 B), que es
// lo que usa el desafío de autenticación (4.4) y lo único que el equipo conserva (cifrado).
import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'crypto'

export const PBKDF2_ITERATIONS = 600_000
const SALT_BYTES = 16
const KEY_BYTES = 32
export const MIN_PASSWORD_LENGTH = 8

/** Parámetros públicos que el equipo envía en `hello` para que el controlador derive la misma K. */
export interface PasswordParams {
  salt: string // base64
  iterations: number
}

export function newPasswordParams(): PasswordParams {
  return { salt: randomBytes(SALT_BYTES).toString('base64'), iterations: PBKDF2_ITERATIONS }
}

export function deriveKey(password: string, params: PasswordParams): Buffer {
  // NFC para que la misma contraseña derive la misma K en cualquier sistema
  return pbkdf2Sync(
    password.normalize('NFC'),
    Buffer.from(params.salt, 'base64'),
    params.iterations,
    KEY_BYTES,
    'sha256'
  )
}

export function keysEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b)
}

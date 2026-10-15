// Desafío de autenticación del control remoto (add-remote-desktop D6). La contraseña del PC NUNCA
// viaja: el equipo envía en `hello` {salt, iterations, nonce} y el controlador prueba que conoce la
// contraseña con proof = HMAC-SHA256(K, contexto ‖ nonce ‖ huellaOferta ‖ huellaRespuesta), donde
// K = PBKDF2(contraseña, salt, iterations) y las huellas son las de las descripciones DTLS. Incluir
// las huellas ata la prueba a ESTA conexión cifrada: un intermediario que cambiara las huellas para
// interponerse vería valores distintos en cada lado y la prueba no coincidiría.
//
// Con WebCrypto (crypto.subtle), disponible en Node y en el navegador, para que el proceso principal
// (verifica) y el renderer del controlador (calcula) usen exactamente el mismo cálculo. La app móvil
// lo reproduce en Dart con los mismos vectores (auth-vectors.json).

const CONTEXT = 'absor-remote-auth-v1'

export interface ProofInput {
  /** nonce aleatorio del equipo, en base64 (se usa tal cual, como texto). */
  nonce: string
  /** Huella DTLS (`a=fingerprint`) de la oferta, tal como la ve cada lado. */
  offerFingerprint: string
  /** Huella DTLS de la respuesta. */
  answerFingerprint: string
}

/**
 * Huella DTLS de una descripción de sesión: el valor de su primera línea `a=fingerprint:` (p. ej.
 * "sha-256 AB:CD:…"), sin espacios alrededor. Las dos partes la sacan del mismo texto, que el
 * servicio entrega sin tocar; la app móvil sigue la misma regla.
 */
export function sdpFingerprint(sdp: string): string | null {
  const match = /^a=fingerprint:(.+)$/m.exec(sdp.replace(/\r\n/g, '\n'))
  return match ? match[1].trim() : null
}

/** Mensaje firmado: campos separados por saltos de línea (ni las huellas ni el base64 los contienen). */
function message(input: ProofInput): Uint8Array {
  return new TextEncoder().encode(
    `${CONTEXT}\n${input.nonce}\n${input.offerFingerprint}\n${input.answerFingerprint}`
  )
}

/** Copia a un Uint8Array respaldado por un ArrayBuffer (lo que WebCrypto espera como BufferSource). */
function toBufferSource(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy
}

/** proof (base64) que demuestra conocer K para esta conexión. `key` son los 32 bytes de K. */
export async function computeProof(key: Uint8Array, input: ProofInput): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    toBufferSource(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, toBufferSource(message(input)))
  return toBase64(new Uint8Array(signature))
}

/** El equipo verifica la prueba del controlador, en tiempo constante. */
export async function verifyProof(
  key: Uint8Array,
  input: ProofInput,
  proof: string
): Promise<boolean> {
  return constantTimeEqual(await computeProof(key, input), proof)
}

/** Comparación en tiempo constante de dos cadenas base64 (evita filtrar por el tiempo). */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function toBase64(bytes: Uint8Array): string {
  if (typeof btoa === 'function') {
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return btoa(binary)
  }
  // Node sin btoa (poco habitual): Buffer vía globalThis, para no exigir sus tipos en el renderer
  const nodeBuffer = (
    globalThis as { Buffer?: { from(b: Uint8Array): { toString(enc: string): string } } }
  ).Buffer
  if (nodeBuffer) return nodeBuffer.from(bytes).toString('base64')
  throw new Error('No hay btoa ni Buffer para codificar en base64')
}

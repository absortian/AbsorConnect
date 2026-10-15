// Caja de cifrado real con el almacén seguro del sistema (Llavero en macOS, DPAPI en Windows,
// libsecret/kwallet en Linux), como el token de sesión (src/main/cloud/session.ts). Sin almacén
// seguro, cae a la caja en claro, igual que la sesión, y Ajustes lo indica.
import { safeStorage } from 'electron'
import { createPlaintextBox, SecretBox } from './secretBox'

const SAFE_PREFIX = 'v1:'

export function createSafeBox(): SecretBox {
  if (!safeStorage.isEncryptionAvailable()) return createPlaintextBox()
  return {
    available: true,
    seal: (plain) =>
      SAFE_PREFIX + safeStorage.encryptString(plain.toString('base64')).toString('base64'),
    open: (stored) => {
      const payload = stored.startsWith(SAFE_PREFIX) ? stored.slice(SAFE_PREFIX.length) : stored
      return Buffer.from(safeStorage.decryptString(Buffer.from(payload, 'base64')), 'base64')
    }
  }
}

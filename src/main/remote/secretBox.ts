// Cifrado de los secretos del control remoto en disco (add-remote-desktop D6/D14). Interfaz pura:
// la implementación con safeStorage vive en safeBox.ts (depende de Electron). Así los almacenes y
// sus tests no dependen de Electron: reciben la caja ya construida.
export interface SecretBox {
  /** true si cifra de verdad (hay almacén seguro del sistema). */
  readonly available: boolean
  /** Devuelve un texto almacenable a partir de los bytes en claro. */
  seal(plain: Buffer): string
  /** Recupera los bytes en claro de un valor almacenado. */
  open(stored: string): Buffer
}

const PLAIN_PREFIX = 'p1:'

/**
 * Caja de respaldo sin cifrado real (Linux sin keyring, y los tests). Marca el valor con un prefijo
 * para distinguirlo de uno cifrado. En producción, Ajustes indica cuando no hay almacén seguro.
 */
export function createPlaintextBox(): SecretBox {
  return {
    available: false,
    seal: (plain) => PLAIN_PREFIX + plain.toString('base64'),
    open: (stored) =>
      Buffer.from(
        stored.startsWith(PLAIN_PREFIX) ? stored.slice(PLAIN_PREFIX.length) : stored,
        'base64'
      )
  }
}

export function isPlaintext(stored: string): boolean {
  return stored.startsWith(PLAIN_PREFIX)
}

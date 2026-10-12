// Entrada de una terminal: lo que se teclea mientras la sesión se abre o se reconecta se
// guarda y se envía en orden al abrirse; con la sesión abierta, cada tecla sale al momento.
// Con la sesión terminada no se guarda nada, para no ejecutar órdenes antiguas al reconectar.
export interface TerminalInput {
  /** Tecla o texto pegado */
  write(data: string): void
  /** La sesión empieza a abrirse: lo que llegue se guarda */
  opening(): void
  /** Sesión abierta: envía lo guardado y, después, cada tecla al momento */
  open(send: (data: string) => void): void
  /** La apertura falló o la sesión terminó: descarta lo guardado y deja de guardar */
  close(): void
}

export function createTerminalInput(): TerminalInput {
  let state: 'closed' | 'opening' | 'open' = 'closed'
  let send: ((data: string) => void) | null = null
  let pending: string[] = []

  return {
    write(data) {
      if (state === 'open' && send) send(data)
      else if (state === 'opening') pending.push(data)
    },
    opening() {
      state = 'opening'
      send = null
    },
    open(fn) {
      const queued = pending.join('')
      pending = []
      state = 'open'
      send = fn
      if (queued) fn(queued)
    },
    close() {
      state = 'closed'
      send = null
      pending = []
    }
  }
}

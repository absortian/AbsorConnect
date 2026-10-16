// Manejo de una ventana de la app por el protocolo de DevTools (--remote-debugging-port), para las
// pruebas manuales: listar las páginas, evaluar código y esperar a que algo se cumpla.

export interface Target {
  id: string
  type: string
  title?: string
  url: string
  webSocketDebuggerUrl: string
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export async function targets(port: number): Promise<Target[]> {
  try {
    return (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as Target[]
  } catch {
    return []
  }
}

export async function waitTarget(
  port: number,
  match: (t: Target) => boolean,
  ms = 30_000
): Promise<Target> {
  const deadline = Date.now() + ms
  for (;;) {
    const found = (await targets(port)).find((t) => t.type === 'page' && match(t))
    if (found) return found
    if (Date.now() > deadline) throw new Error('No aparece la ventana esperada')
    await sleep(500)
  }
}

export class Page {
  private ws!: WebSocket
  private next = 1
  private pending = new Map<number, (value: any) => void>()

  static async open(target: Target): Promise<Page> {
    const page = new Page()
    page.ws = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      page.ws.onopen = resolve
      page.ws.onerror = reject
    })
    // Si la ventana se cierra (p. ej. al pulsar un botón que la destruye), lo pendiente no tendrá
    // respuesta: se resuelve sin valor en vez de esperar para siempre
    page.ws.onclose = () => {
      for (const resolve of page.pending.values()) resolve({ closed: true })
      page.pending.clear()
    }
    page.ws.onmessage = (event) => {
      const message = JSON.parse(String(event.data))
      if (message.id && page.pending.has(message.id)) {
        page.pending.get(message.id)!(message)
        page.pending.delete(message.id)
      }
    }
    return page
  }

  /**
   * Una orden de DevTools. Con límite de tiempo: si la página se queda sin responder (p. ej. con sus
   * temporizadores frenados por estar oculta en macOS), la prueba falla diciendo dónde, en vez de
   * quedarse esperando.
   */
  send(method: string, params: object = {}, timeoutMs = 60_000): Promise<any> {
    const id = this.next++
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        const what = 'expression' in params ? String((params as { expression: string }).expression).trim().slice(0, 80) : ''
        reject(new Error(`DevTools: ${method} sin respuesta en ${timeoutMs / 1000} s ${what}`))
      }, timeoutMs)
      this.pending.set(id, (value) => {
        clearTimeout(timer)
        resolve(value)
      })
    })
  }

  async eval<T>(expression: string): Promise<T> {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    })
    if (result.result?.exceptionDetails) {
      throw new Error(JSON.stringify(result.result.exceptionDetails).slice(0, 300))
    }
    return result.result?.result?.value as T
  }

  async waitFor<T>(expression: string, ok: (value: T) => boolean, ms = 30_000): Promise<T> {
    const deadline = Date.now() + ms
    for (;;) {
      const value = await this.eval<T>(expression).catch(() => undefined as T)
      if (ok(value) || Date.now() > deadline) return value
      await sleep(400)
    }
  }

  /** Captura de la página en PNG (para revisar a ojo cómo queda). */
  async screenshot(): Promise<Buffer> {
    const result = await this.send('Page.captureScreenshot', { format: 'png' })
    return Buffer.from(result.result.data, 'base64')
  }

  close(): void {
    this.ws.close()
  }
}

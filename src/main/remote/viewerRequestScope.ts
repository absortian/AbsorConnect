import type { ViewerRequestResult } from '../../shared/remote/viewerBridge'
/** Solo la solicitud creada por este visor se puede consultar desde él. */
export class ViewerRequestScope {
  private creating = false
  private current: string | null = null
  permits(id: unknown): boolean {
    return typeof id === 'string' && id === this.current
  }
  async create(
    allowed: () => boolean,
    send: () => Promise<ViewerRequestResult>
  ): Promise<ViewerRequestResult> {
    if (!allowed()) return { ok: false, code: 'forbidden' }
    if (this.creating) return { ok: false, code: 'busy' }
    this.creating = true
    this.current = null
    try {
      const result = await send()
      if (!allowed()) return { ok: false, code: 'forbidden' }
      if (result.ok) this.current = result.id
      return result
    } finally {
      this.creating = false
    }
  }
}

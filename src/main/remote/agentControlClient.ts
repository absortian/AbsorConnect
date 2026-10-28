// Canal separado de la lectura de estado; solo parada terminal del propio equipo.
import { execFile } from 'child_process'
import { isDeviceId } from '../../shared/remote/agentDevice'
import type { LocalAgentStopResult } from '../../shared/remote/localAgent'
import { protectedLinuxHelper } from './agentStatusClient'

export interface AgentControlSource {
  available(): Promise<boolean>
  stop(deviceId: string): Promise<string>
}
export function parseStopReply(raw: string, deviceId: string): boolean {
  if (!isDeviceId(deviceId) || !raw || Buffer.byteLength(raw) > 512) return false
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const v = value as Record<string, unknown>
    return (
      JSON.stringify(v) === raw &&
      Object.keys(v).length === 5 &&
      v.v === 1 &&
      v.deviceId === deviceId &&
      v.stopped === true &&
      v.freshEnrollmentRequired === true &&
      typeof v.nonce === 'string' &&
      /^[0-9a-f]{32}$/.test(v.nonce)
    )
  } catch {
    return false
  }
}
export class AgentControlClient {
  private pending: Promise<LocalAgentStopResult> | null = null
  constructor(private readonly source: AgentControlSource) {}
  async available(): Promise<boolean> {
    try {
      return await this.source.available()
    } catch {
      return false
    }
  }
  stop(deviceId: string): Promise<LocalAgentStopResult> {
    if (!isDeviceId(deviceId)) return Promise.resolve({ ok: false, code: 'local_agent_unverified' })
    if (this.pending) return Promise.resolve({ ok: false, code: 'local_agent_busy' })
    this.pending = this.run(deviceId).finally(() => {
      this.pending = null
    })
    return this.pending
  }
  private async run(deviceId: string): Promise<LocalAgentStopResult> {
    if (!(await this.available())) return { ok: false, code: 'local_agent_control_unavailable' }
    try {
      const raw = await this.source.stop(deviceId)
      return parseStopReply(raw, deviceId)
        ? { ok: true, freshEnrollmentRequired: true }
        : { ok: false, code: 'local_agent_stop_unconfirmed' }
    } catch {
      return { ok: false, code: 'local_agent_stop_unconfirmed' }
    }
  }
}
/** Ubicación inyectable solo por el arnés de VM; ningún argumento IPC selecciona un ejecutable. */
export function installedAgentControlSource(
  helper = '/usr/lib/absorconnect/absor-agent-control'
): AgentControlSource {
  return {
    available: async () => {
      if (process.platform !== 'linux') return false
      await protectedLinuxHelper(helper)
      return true
    },
    stop: async (deviceId) => {
      if (process.platform !== 'linux' || !isDeviceId(deviceId))
        throw Error('local_agent_control_unavailable')
      await protectedLinuxHelper(helper)
      return new Promise((resolve, reject) => {
        execFile(
          helper,
          ['stop', '--device-id', deviceId, '--json'],
          {
            cwd: '/',
            env: { LANG: 'C' },
            encoding: 'utf8',
            timeout: 1500,
            maxBuffer: 512,
            killSignal: 'SIGKILL'
          },
          (error, stdout) => {
            if (error) reject(Error('local_agent_stop_unconfirmed'))
            else resolve(stdout)
          }
        )
      })
    }
  }
}

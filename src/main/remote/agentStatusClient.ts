// Consulta sin privilegios; nunca instala, da de alta, detiene ni reconfigura al agente.
import { execFile } from 'child_process'
import * as fs from 'fs/promises'
import { dirname, isAbsolute } from 'path'
import { isDeviceId } from '../../shared/remote/agentDevice'
import {
  absentLocalAgent,
  LocalAgentSnapshot,
  publicLocalAgentSnapshot,
  unverifiedLocalAgent
} from '../../shared/remote/localAgent'
const MAX_STATUS_BYTES = 512
const KEYS = [
  'v',
  'nonce',
  'owner',
  'deviceId',
  'agentVersion',
  'instance',
  'bootId',
  'pid',
  'publishedAtBoottimeMillis',
  'state',
  'readyForUnattended'
]
const HEX = /^[0-9a-f]{32}$/
const BOOT = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/
const VERSION = /^[A-Za-z0-9.+-]{1,32}$/
const STATES = new Set(['idle', 'active', 'validation_required', 'revoked'])
/** La salida procede del cliente instalado; el cliente verifica nonce, kernel y plazo del RPC. */
export function parseLocalAgentStatus(raw: string): LocalAgentSnapshot | null {
  if (Buffer.byteLength(raw, 'utf8') > MAX_STATUS_BYTES || !raw) return null
  let v: Record<string, unknown>
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    v = value as Record<string, unknown>
    // La codificación compacta del cliente es canónica. Evita duplicados/escapes ambiguos.
    if (JSON.stringify(v) !== raw) return null
  } catch {
    return null
  }
  if (
    Object.keys(v).length !== KEYS.length ||
    !KEYS.every((key) => Object.hasOwn(v, key)) ||
    v.v !== 1 ||
    v.owner !== 'agent' ||
    !isDeviceId(v.deviceId) ||
    typeof v.nonce !== 'string' ||
    !HEX.test(v.nonce) ||
    typeof v.instance !== 'string' ||
    !HEX.test(v.instance) ||
    typeof v.bootId !== 'string' ||
    !BOOT.test(v.bootId) ||
    typeof v.agentVersion !== 'string' ||
    !VERSION.test(v.agentVersion) ||
    typeof v.pid !== 'number' ||
    !Number.isInteger(v.pid) ||
    v.pid < 1 ||
    v.pid > 0xffff_ffff ||
    typeof v.publishedAtBoottimeMillis !== 'number' ||
    !Number.isSafeInteger(v.publishedAtBoottimeMillis) ||
    v.publishedAtBoottimeMillis < 0 ||
    typeof v.state !== 'string' ||
    !STATES.has(v.state) ||
    v.readyForUnattended !== false
  )
    return null
  return {
    ownership: 'agent',
    phase: 'responding',
    deviceId: v.deviceId,
    agentVersion: v.agentVersion,
    state: v.state as LocalAgentSnapshot['state'],
    active: v.state === 'active',
    readyForUnattended: false
  }
}
export interface AgentStatusSource {
  /** Ausencia comprobada del marcador de intención, no solo del proceso. */
  presence(): Promise<'absent' | 'installed'>
  query(signal: AbortSignal): Promise<string>
}
/** Una propiedad observada no se pierde por un timeout, desinstalación parcial o consulta tardía. */
export class AgentStatusClient {
  private snapshot = absentLocalAgent()
  private observed = false
  private closed = false
  private pending: Promise<LocalAgentSnapshot> | null = null
  private abort: AbortController | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private watching = false
  constructor(private readonly source: AgentStatusSource) {}
  get isClosed(): boolean {
    return this.closed
  }
  current(): LocalAgentSnapshot {
    return publicLocalAgentSnapshot(this.snapshot)
  }
  read(): Promise<LocalAgentSnapshot> {
    if (this.closed) return Promise.resolve(this.current())
    this.pending ??= this.probe().finally(() => {
      this.pending = null
    })
    return this.pending
  }
  private async probe(): Promise<LocalAgentSnapshot> {
    let next: LocalAgentSnapshot
    try {
      const presence = await this.source.presence()
      if (this.closed) return this.current()
      if (presence === 'absent') {
        next = this.observed ? unverifiedLocalAgent(this.snapshot) : absentLocalAgent()
      } else {
        this.observed = true
        this.abort = new AbortController()
        next =
          parseLocalAgentStatus(await this.source.query(this.abort.signal)) ??
          unverifiedLocalAgent(this.snapshot)
      }
    } catch {
      this.observed = true
      next = unverifiedLocalAgent(this.snapshot)
    }
    if (!this.closed) this.snapshot = next
    this.abort = null
    return this.current()
  }
  watch(onChange: (snapshot: LocalAgentSnapshot) => void, interval = 1000): void {
    if (this.closed || this.watching) return
    this.watching = true
    const tick = async (): Promise<void> => {
      const value = await this.read()
      if (this.closed) return
      try {
        onChange(value)
      } catch {
        // El observador no cambia la propiedad ni debe detener la vigilancia.
      }
      this.timer = setTimeout(() => {
        this.timer = null
        void tick()
      }, interval)
    }
    this.timer = setTimeout(() => {
      this.timer = null
      void tick()
    }, interval)
  }
  close(): void {
    this.closed = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.abort?.abort()
    if (this.observed) this.snapshot = unverifiedLocalAgent(this.snapshot)
  }
}
interface InstalledStatusCommand {
  helper: string
  marker: string
  platform: NodeJS.Platform
}
const LOCATIONS: Partial<Record<NodeJS.Platform, InstalledStatusCommand>> = {
  linux: {
    helper: '/usr/lib/absorconnect/absor-agent-status',
    marker: '/var/lib/absorconnect/installation.json',
    platform: 'linux'
  },
  win32: {
    helper: 'C:\\Program Files\\AbsorConnect Agent\\absor-agent-status.exe',
    marker: 'C:\\ProgramData\\AbsorConnect\\installation.json',
    platform: 'win32'
  },
  darwin: {
    helper: '/Library/PrivilegedHelperTools/top.absor.connect.agent-status',
    marker: '/Library/Application Support/AbsorConnectAgent/installation.json',
    platform: 'darwin'
  }
}
async function protectedLinuxHelper(path: string): Promise<void> {
  if (!isAbsolute(path)) throw new Error('agent_helper_invalid')
  const file = await fs.lstat(path)
  if (
    !file.isFile() ||
    file.uid !== 0 ||
    file.gid !== 0 ||
    file.nlink !== 1 ||
    (file.mode & 0o7777) !== 0o755 ||
    file.size < 1 ||
    file.size > 20_000_000
  )
    throw new Error('agent_helper_invalid')
  let parent = dirname(path)
  while (true) {
    const directory = await fs.lstat(parent)
    if (!directory.isDirectory() || directory.uid !== 0 || (directory.mode & 0o022) !== 0)
      throw new Error('agent_helper_invalid')
    const next = dirname(parent)
    if (next === parent) break
    parent = next
  }
}
async function protectedLinuxMarker(path: string): Promise<void> {
  const file = await fs.lstat(path)
  if (
    !file.isFile() ||
    file.uid !== 0 ||
    file.gid !== 0 ||
    file.nlink !== 1 ||
    ![0o444, 0o644].includes(file.mode & 0o7777) ||
    file.size > 4096
  ) {
    throw new Error('agent_installation_unverified')
  }
  let parent = dirname(path)
  while (true) {
    const directory = await fs.lstat(parent)
    if (!directory.isDirectory() || directory.uid !== 0 || (directory.mode & 0o022) !== 0) {
      throw new Error('agent_installation_unverified')
    }
    const next = dirname(parent)
    if (next === parent) break
    parent = next
  }
}
/** La ubicación se inyecta solo desde el arnés de VM; el runtime usa constantes del paquete. */
export function installedAgentSource(location = LOCATIONS[process.platform]): AgentStatusSource {
  return {
    presence: async () => {
      if (!location) return 'absent'
      try {
        await fs.lstat(location.marker)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'absent'
        throw new Error('agent_installation_unverified')
      }
      if (location.platform === 'linux') await protectedLinuxMarker(location.marker)
      return 'installed'
    },
    query: async (signal) => {
      // Los adaptadores ACL/XPC finales conservan sus gates; no se ejecuta un helper sin validar.
      if (!location || location.platform !== 'linux' || process.platform !== 'linux')
        throw new Error('agent_status_unsupported')
      await protectedLinuxHelper(location.helper)
      return new Promise<string>((resolve, reject) => {
        execFile(
          location.helper,
          ['status', '--json'],
          {
            cwd: '/',
            env: { LANG: 'C' },
            encoding: 'utf8',
            timeout: 1200,
            maxBuffer: MAX_STATUS_BYTES,
            killSignal: 'SIGKILL',
            signal
          },
          (error, stdout) => {
            if (error) reject(new Error('agent_status_unavailable'))
            else resolve(stdout)
          }
        )
      })
    }
  }
}

// Misma implementación Main, ejecutada sin privilegios en la VM propia.
import { AgentStatusClient, installedAgentSource } from '../../src/main/remote/agentStatusClient'
import { AgentControlClient, installedAgentControlSource } from '../../src/main/remote/agentControlClient'
import { isDeviceId } from '../../src/shared/remote/agentDevice'
import { HostService } from '../../src/main/remote/hostService'
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
async function main(): Promise<void> {
  if (process.platform !== 'linux' || process.getuid?.() !== 1000) throw Error('owned_user_required')
  if (process.argv.length === 4 && process.argv[2] === '--stop' && isDeviceId(process.argv[3])) {
    const control = new AgentControlClient(installedAgentControlSource('/opt/absorconnect-secure-lab/absor-agent-control-lab'))
    const result = await control.stop(process.argv[3])
    if (!result.ok) throw Error('stop_unconfirmed')
    console.log(JSON.stringify(result))
    return
  }
  if (process.argv.length !== 2) throw Error('invalid_arguments')
  let apiCalls = 0, identities = 0, sessions = 0, reservations = 0
  const ids = new Set<string>()
  for (let episode = 0; episode < 6; episode++) {
    const client = new AgentStatusClient(installedAgentSource({ platform: 'linux',
      helper: '/opt/absorconnect-secure-lab/absor-agent-status-lab', marker: '/opt/absorconnect-secure-lab/ui-profile.json' }))
    const snapshot = await client.read()
    if (snapshot.phase !== 'responding' || !snapshot.active || !snapshot.deviceId || snapshot.readyForUnattended) throw Error('native_status_required')
    ids.add(snapshot.deviceId)
    let enabled = true
    const unexpected = async (): Promise<never> => { apiCalls++; throw Error('legacy_api_forbidden') }
    const service = new HostService({
      api: { register: unexpected, poll: unexpected, answer: unexpected, reject: unexpected },
      identity: { get: async () => { identities++; throw Error('legacy_identity_forbidden') }, reset: async () => { identities++; throw Error('identity_reset_forbidden') } },
      store: { isEnabled: async () => enabled, snapshot: async () => ({ enabled, deviceName: 'Ventana propia', hasPassword: true,
        features: { clipboard: false, files: false, audio: false }, confirmLocal: false, preventSleep: false, encryptionAvailable: true }),
        lockRemainingSeconds: async () => 0, addLog: async () => {} },
      support: () => ({ state: 'available' }), signedIn: () => true, platform: 'linux', appVersion: '0.4.1',
      openSession: async () => { sessions++; throw Error('legacy_session_forbidden') },
      setKeepAwake: () => {}, setStatus: () => {}, notify: () => {},
      onAgentOwned: async () => { reservations++; enabled = false }, nativeAgent: () => client.read()
    })
    service.start();
    const deadline=Date.now()+2000
    while (!service.isAgentManaged() && Date.now()<deadline) await wait(10)
    if (!service.isAgentManaged() || enabled) throw Error('legacy_not_reserved')
    service.refresh(); service.resume(); await wait(20)
    await service.stop(); client.close()
    if (apiCalls || identities || sessions) throw Error('legacy_side_effect')
  }
  if (ids.size !== 1 || reservations !== 6) throw Error('duplicate_identity')
  console.log(JSON.stringify({ schema: 1, episodes: 6, sameDevice: true, legacyApiCalls: apiCalls,
    legacyIdentityReadsOrResets: identities, legacySessionsOpened: sessions,
    nativeStopCommands: 0, readyForUnattended: false }))
}
void main().catch(() => { console.error('ui_runtime_failed'); process.exitCode = 3 })

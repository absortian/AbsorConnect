// Alta/baja desde el frame principal, con confirmación y vínculo revalidado por Main.
import { dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { getMainWindow } from '../background'
import { currentSession } from '../cloud/session'
import { getLanguage } from '../store'
import { agentSetup, remoteHostStarted } from './hostRuntime'
import {
  agentSetupChoice,
  publicAgentSetupResult,
  publicAgentSetupState,
  type AgentSetupResult
} from '../../shared/remote/agentSetup'
const forbidden: AgentSetupResult = { ok: false, code: 'forbidden' }
function trusted(event: IpcMainInvokeEvent): boolean {
  const main = getMainWindow()
  return (
    !!main && event.sender === main.webContents && event.senderFrame === main.webContents.mainFrame
  )
}
let ready = false
export function setupAgentSetupIpc(): void {
  if (ready) return
  ready = true
  ipcMain.handle('agent-setup:get', async (event, ...args): Promise<AgentSetupResult> => {
    if (!trusted(event) || args.length !== 0) return forbidden
    await remoteHostStarted()
    const setup = agentSetup()
    if (!setup) return { ok: false, code: 'agent_setup_unavailable' }
    try {
      return { ok: true, state: publicAgentSetupState(await setup.state()) }
    } catch {
      return { ok: false, code: 'agent_setup_intervention_required' }
    }
  })
  for (const action of ['prepare', 'recover', 'commit', 'cancel', 'retire'] as const) {
    ipcMain.handle('agent-setup:' + action, async (event, ...args): Promise<AgentSetupResult> => {
      if (
        !trusted(event) ||
        (action === 'prepare' ? args.length !== 1 || !agentSetupChoice(args[0]) : args.length !== 0)
      )
        return forbidden
      await remoteHostStarted()
      const account = currentSession(),
        setup = agentSetup()
      if (!account) return { ok: false, code: 'not_signed_in' }
      if (!setup) return { ok: false, code: 'agent_setup_unavailable' }
      try {
        const state = await setup.state()
        if (!state.providerAvailable) return { ok: false, code: 'agent_setup_unavailable' }
        if (state.busy) return { ok: false, code: 'agent_setup_busy' }
        const scope = await setup.confirmationScope()
        if (!trusted(event) || currentSession() !== account) return { ok: false, code: 'cancelled' }
        const parent = getMainWindow(),
          spanish = (await getLanguage()) === 'es'
        if (!parent) return { ok: false, code: 'cancelled' }
        const response = await dialog.showMessageBox(parent, {
          type: 'warning',
          title: 'Absor Connect',
          message: spanish
            ? action === 'commit'
              ? '¿Activar el acceso desatendido de este PC?'
              : '¿Continuar la configuración del host de este PC?'
            : action === 'commit'
              ? 'Activate unattended access on this PC?'
              : 'Continue configuring this PC’s host?',
          detail: spanish
            ? action === 'retire' || action === 'cancel'
              ? 'Se retirará este traspaso y se cortarán sus sesiones. El modo de usuario solo se recuperará tras verificar la retirada local y en la cuenta.'
              : action === 'commit'
                ? 'El servicio podrá continuar al cerrar la interfaz, según tu elección de confirmación local. Esta configuración aún no está certificada.'
                : 'Se conservarán la identidad y la contraseña del PC. ' +
                  (action === 'prepare' && agentSetupChoice(args[0]) && !args[0].confirmLocal
                    ? 'Has elegido permitir conexiones sin confirmación delante del PC. '
                    : '') +
                  'Preparar no activa el servicio: la activación exige otra confirmación. Los permisos de administrador se solicitan en el sistema.'
            : action === 'retire' || action === 'cancel'
              ? 'This removes this migration and ends its sessions. User mode resumes only after local and account removal are verified.'
              : action === 'commit'
                ? 'The service may continue when the interface closes, according to your local confirmation choice. This configuration is not certified yet.'
                : 'This preserves the PC identity and password. ' +
                  (action === 'prepare' && agentSetupChoice(args[0]) && !args[0].confirmLocal
                    ? 'You chose to allow connections without confirmation at the PC. '
                    : '') +
                  'Preparation does not activate the service: activation requires another confirmation. Administrator permissions are requested by the OS.',
          buttons: spanish ? ['Cancelar', 'Continuar'] : ['Cancel', 'Continue'],
          defaultId: 0,
          cancelId: 0,
          noLink: true
        })
        const afterScope = response.response === 1 ? await setup.confirmationScope() : null
        if (
          response.response !== 1 ||
          !trusted(event) ||
          currentSession() !== account ||
          afterScope !== scope
        )
          return { ok: false, code: 'cancelled' }
        const value =
          action === 'prepare'
            ? await setup.begin(args[0] as { confirmLocal: boolean; activate: boolean })
            : action === 'recover'
              ? await setup.recover()
              : action === 'commit'
                ? await setup.commit()
                : await setup.cancel()
        return publicAgentSetupResult(value)
      } catch {
        return { ok: false, code: 'agent_setup_intervention_required' }
      }
    })
  }
}

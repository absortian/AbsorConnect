// Ventana aislada con los canales de producción; sustituye solo cuenta/coordinador de prueba.
const {app,BrowserWindow,dialog}=require('electron')
const fs=require('node:fs'),path=require('node:path')
const directory=process.argv.find(v=>v.startsWith('--owned-work='))?.slice(13)
if(!directory||!path.isAbsolute(directory))throw Error('owned_work_required')
app.setPath('userData',path.join(directory,'electron-profile'))
let state={phase:'idle',providerAvailable:true,busy:false,canCommit:false,freshEnrollmentRequired:false,readyForUnattended:false}
let mode='normal',answer=0,prepares=0,commits=0,cancels=0
global.fixtureAccount={token:'account-secret-not-rendered',email:'fixture@example.invalid'}
const result=()=>({ok:true,state:{...state,key:'K-not-rendered',credential:'acg_not_rendered',accountBinding:'private-binding'}})
global.fixtureSetup={state:async()=>result().state,confirmationScope:async()=> 'private-scope',
  begin:async(choice)=>{prepares++;if(mode==='fault'){state={...state,phase:'intervention_required'};throw Error('private-error')}
    state={...state,phase:'prepared',canCommit:mode!=='unsupported',freshEnrollmentRequired:true};return result()},
  recover:async()=>{state={...state,phase:'prepared',canCommit:true};return result()},
  commit:async()=>{commits++;state={...state,phase:'committed',canCommit:false};return result()},
  cancel:async()=>{cancels++;state={...state,phase:'idle',freshEnrollmentRequired:false};return result()}}
dialog.showMessageBox=async()=>({response:answer,checkboxChecked:false})
const assert=(v)=>{if(!v)throw Error('setup_ui_assertion')}
app.whenReady().then(async()=>{
  try{
    const window=global.fixtureWindow=new BrowserWindow({show:false,width:900,height:900,webPreferences:{preload:path.join(directory,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}})
    require(path.join(directory,'setup-ipc.cjs')).setupAgentSetupIpc()
    await window.loadFile(path.join(directory,'index.html'))
    const evaluate=(code)=>window.webContents.executeJavaScript(code,true)
    const until=async(code)=>{const end=Date.now()+12000;while(Date.now()<end){if(await evaluate(code))return;await new Promise(r=>setTimeout(r,60))}throw Error('setup_ui_timeout')}
    const contains=(text)=>'document.body.innerText.includes('+JSON.stringify(text)+')'
    const click=(text)=>evaluate('Array.from(document.querySelectorAll("button")).find(b=>b.textContent==='+JSON.stringify(text)+').click()')
    await until(contains('Modo de usuario.'))
    assert(await evaluate('document.querySelector("button").disabled && !document.querySelector("input:checked")'))
    await evaluate('document.querySelectorAll("input[type=radio]")[1].click()')
    await until('!document.querySelector("button").disabled')
    await click('Preparar traspaso');await until(contains('Operación cancelada.'));assert(prepares===0)
    answer=1;mode='unsupported';await click('Preparar traspaso');await until(contains('Las opciones importadas requieren'))
    assert(await evaluate('Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="Confirmar activación").disabled'))
    await click('Retirar este traspaso');await until(contains('Modo de usuario.'))
    mode='normal';await click('Preparar traspaso');await until('Array.from(document.querySelectorAll("button")).some(b=>b.textContent==="Confirmar activación"&&!b.disabled)')
    await click('Confirmar activación');await until(contains('Traspaso confirmado.'))
    await click('Dar de baja el agente de este PC');await until(contains('Modo de usuario.'))
    mode='fault';await click('Preparar traspaso');await until(contains('Requiere intervención:'))
    await click('Comprobar recuperación');await until(contains('Traspaso preparado;'))
    const snapshot=await evaluate('window.api.agentSetupState()'),raw=JSON.stringify(snapshot)
    for(const secret of ['account-secret','K-not-rendered','acg_not_rendered','private-binding','private-scope','private-error'])assert(!raw.includes(secret))
    assert(snapshot.ok&&snapshot.state.readyForUnattended===false)
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    await new Promise(resolve=>setTimeout(resolve,150))
    const picture=await window.webContents.capturePage();fs.writeFileSync(path.join(directory,'prepared.png'),picture.toPNG(),{mode:0o600})
    const report={schema:1,ok:true,cancelledBeforePreparation:true,explicitConfirmationChoice:true,unsupportedPolicyBlocked:true,
      preparedThenCommitted:true,retired:true,serviceFaultShown:true,recoveryShown:true,realPreloadAndMainIpc:true,secretsInRenderer:false,
      preparedCalls:prepares,committedCalls:commits,retiredOrCancelledCalls:cancels,readyForUnattended:false,productionInstallerTested:false}
    fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600})
    window.destroy();app.quit()
  }catch{fs.writeFileSync(path.join(directory,'failure.json'),'{"ok":false,"code":"setup_ui_failed"}',{mode:0o600});app.exit(3)}
})

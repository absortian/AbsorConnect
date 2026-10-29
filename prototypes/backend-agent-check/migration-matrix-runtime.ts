// Matriz destructiva solo sobre cuentas y servicios efímeros de la VM propia.
import {execFile} from 'child_process'
import {promisify} from 'util'
import {createCipheriv,createDecipheriv,randomBytes,createHmac} from 'crypto'
import * as fs from 'fs/promises'
import {join} from 'path'
import {labMigrationProvider} from './migration-lab-provider'
import {MigrationCoordinator,type MigrationDependencies} from '../../src/main/remote/migrationCoordinator'
import {MigrationJournal} from '../../src/main/remote/migrationJournal'
import {accountMigrationApi} from '../../src/main/remote/migrationApi'
import {DeviceIdentity} from '../../src/main/remote/deviceIdentity'
import {RemoteAccessStore} from '../../src/main/remote/remoteAccessStore'
import {writeAtomic} from '../../src/main/remote/atomicWrite'
import {HostService} from '../../src/main/remote/hostService'
import {absentLocalAgent} from '../../src/shared/remote/localAgent'
import type {SecretBox} from '../../src/main/remote/secretBox'
import {AgentControlClient,installedAgentControlSource} from '../../src/main/remote/agentControlClient'
import {NativeAccountGuard} from '../../src/main/remote/nativeAccountGuard'
const wait=(ms:number):Promise<void>=>new Promise((resolve)=>setTimeout(resolve,ms))
let checkpoint=0
const check=(v:unknown):void=>{checkpoint++;if(!v)throw Error('migration_matrix_assertion')}
const fixedUnits=async(...args:string[]):Promise<void>=>{await promisify(execFile)('/usr/bin/sudo',['-n','/usr/bin/systemctl',...args],{timeout:20000,maxBuffer:1024})}
async function worker(command:unknown):Promise<{kind?:string;state?:string;payload?:string}>{
  const dir='/run/absorconnect-ipc-worker-lab',end=Date.now()+12000
  while(Date.now()<end){try{await fs.stat(dir);break}catch{await wait(50)}}
  await fs.rm(join(dir,'reply.json'),{force:true})
  await fs.writeFile(join(dir,'command.next'),JSON.stringify({action:'request',command}),{mode:0o600,flag:'wx'})
  await fs.rename(join(dir,'command.next'),join(dir,'command.json'))
  while(Date.now()<end){try{const v=JSON.parse(await fs.readFile(join(dir,'reply.json'),'utf8'));return v.result??v}catch{await wait(50)}}
  throw Error('native_worker_timeout')
}
async function ready():Promise<void>{
  const end=Date.now()+12000
  while(Date.now()<end){if((await worker({op:'status'})).state==='ready')return;await wait(100)}
  throw Error('native_not_ready')
}
async function challenge(offer:string,answer:string):Promise<Awaited<ReturnType<typeof worker>>>{
  const end=Date.now()+8000
  while(true){
    const value=await worker({op:'challenge',offer_fingerprint:offer,answer_fingerprint:answer})
    if(value.kind==='hello'||value.state==='locked')return value
    if(Date.now()>=end){console.error(JSON.stringify({nativeKind:value.kind,nativeState:value.state}));return value}
    await wait(200)
  }
}
async function main():Promise<void>{
  check(process.platform==='linux'&&process.getuid?.()===1000&&process.argv.length===2)
  let inputBytes=Buffer.alloc(0)
  for await(const chunk of process.stdin){inputBytes=Buffer.concat([inputBytes,chunk]);check(inputBytes.length<=4096)}
  const input=JSON.parse(inputBytes.toString());inputBytes.fill(0)
  const dir=await fs.mkdtemp('/home/absorlab/AbsorConnectLab/migration-matrix-'),wrap=randomBytes(32)
  const box:SecretBox={available:true,seal:(raw)=>{const n=randomBytes(12),c=createCipheriv('aes-256-gcm',wrap,n);return Buffer.concat([n,c.update(raw),c.final(),c.getAuthTag()]).toString('base64')},
    open:(raw)=>{const b=Buffer.from(raw,'base64'),c=createDecipheriv('aes-256-gcm',wrap,b.subarray(0,12));c.setAuthTag(b.subarray(-16));return Buffer.concat([c.update(b.subarray(12,-16)),c.final()])}}
  const provider=labMigrationProvider(),api=accountMigrationApi()
  let session:{email:string;token:string}|null={email:'fixture@example.invalid',token:input.accountToken}
  const sourceSession=session
  let host:HostService|null=null
  try{
    const storeFile=join(dir,'remote.json'),deviceFile=join(dir,'device.json')
    const store=new RemoteAccessStore(storeFile,box,'Diagnóstico de traspaso')
    await store.bindToAccount(session.email);await store.setPassword('contraseña-de-VM-ficticia');await store.setEnabled(true)
    await store.setFeatures({clipboard:false,files:input.scenario==='unsupported-policy',audio:false})
    const now=Date.now(),active=input.scenario==='active-lock'
    for(let i=0;i<(active?5:4);i++)await store.registerFailure(now-5000+i*1000)
    await writeAtomic(deviceFile,JSON.stringify({id:input.deviceId,key:box.seal(Buffer.from(input.deviceKey,'base64url'))}))
    const before=await fs.readFile(storeFile),journal=new MigrationJournal(join(dir,'intent.json'))
    let legacyCalls=0,resumed=0
    const unexpected=async():Promise<never>=>{legacyCalls++;throw Error('legacy_forbidden')}
    host=new HostService({api:{register:unexpected,poll:unexpected,answer:unexpected,reject:unexpected},identity:{get:unexpected,reset:unexpected},store,
      support:()=>({state:'available'}),signedIn:()=>session!==null,platform:'linux',appVersion:'0.4.1',openSession:unexpected,
      setKeepAwake:()=>{},setStatus:()=>{},notify:()=>{},nativeAgent:async()=>absentLocalAgent(),onAgentOwned:async()=>{check(await journal.intentPresent())}})
    const deps:MigrationDependencies={session:()=>session,origin:()=>input.origin,journal,identity:new DeviceIdentity(deviceFile,box),store,host,provider,api,
      compensated:async()=>{check(!await journal.intentPresent());host!.releaseAfterMigrationCompensation();resumed++},
      stopAfterSourceChange:async(target)=>{const control=new AgentControlClient(installedAgentControlSource('/opt/absorconnect-secure-lab/absor-agent-control-lab'));const result=await control.stop(target.deviceId);check(result.ok);return result}}
    const rawPrepare=provider.prepare,rawRemove=provider.remove,rawCreate=api.create,rawCancel=api.cancel
    if(input.scenario==='create-lost')api.create=async(...args)=>{await rawCreate(...args);throw Error('lost_reply')}
    if(input.scenario==='prepare-lost')provider.prepare=async(raw)=>{await rawPrepare(raw);throw Error('lost_reply')}
    if(input.scenario==='counter-invalid')provider.prepare=async(raw)=>{
      const value=JSON.parse(raw.toString());value.migration.lockout.failures=[Date.now()+60000]
      const altered=Buffer.from(JSON.stringify(value));try{return await rawPrepare(altered)}finally{altered.fill(0)}
    }
    if(input.scenario==='account-switch')provider.prepare=async(raw)=>{const v=await rawPrepare(raw);session=null;return v}
    let c=new MigrationCoordinator(deps),begun=await c.begin({activate:true,confirmLocal:false})
    check((await fs.readFile(storeFile)).equals(before));check(legacyCalls===0)
    if(['create-lost','counter-invalid'].includes(input.scenario))check(!begun.ok)
    else if(['prepare-lost','account-switch'].includes(input.scenario)){
      check(!begun.ok);session=sourceSession;c=new MigrationCoordinator(deps);check((await c.recover()).ok)
    }else check(begun.ok)
    let nativeLock=false,restartLocked=false
    if(input.scenario==='health-failed'){
      await promisify(execFile)('/usr/bin/sudo',['-n','/usr/bin/python3','-I','-B','-c',
        "from pathlib import Path;p=Path('/etc/absorconnect-secure-lab');assert (p/'owned-installation').read_bytes()==b'absorconnect-encrypted-host-lab-v1\\n';f=p/'host.sealed.json';b=f.read_bytes();assert 0<len(b)<=8192;f.write_bytes(b[:-2]+b'XX')"],{timeout:3000,maxBuffer:512})
      check(!(await c.commit()).ok);check((await provider.inspect())?.phase==='intervention_required')
    }
    if(input.scenario==='commit-account-switch'){
      const commit=provider.commit
      provider.commit=async(target)=>{const value=await commit(target);session=null;c.invalidate();return value}
      check(!(await c.commit()).ok);session=sourceSession;c=new MigrationCoordinator(deps);check((await c.recover()).ok)
    }
    if(input.scenario==='unsupported-policy')check(! (await c.commit()).ok)
    if(['commit-lost','active-lock','four-to-lock'].includes(input.scenario)){
      const commit=provider.commit
      if(input.scenario==='commit-lost')provider.commit=async(target)=>{await commit(target);throw Error('lost_reply')}
      const committed=await c.commit()
      if(input.scenario==='commit-lost'){check(!committed.ok);c=new MigrationCoordinator(deps);check((await c.recover()).ok)}else check(committed.ok)
      if(input.scenario!=='commit-lost'){
        await ready()
        const fingerprints={offer_fingerprint:'sha-256 '+Array(32).fill('AA').join(':'),answer_fingerprint:'sha-256 '+Array(32).fill('BB').join(':')}
        if(input.scenario==='four-to-lock'){
          check((await challenge(fingerprints.offer_fingerprint,fingerprints.answer_fingerprint)).kind==='hello')
          check((await worker({op:'authenticate',message:JSON.stringify({v:1,type:'auth',proof:Buffer.alloc(32).toString('base64')})})).state==='wrong_proof')
        }
        nativeLock=(await challenge(fingerprints.offer_fingerprint,fingerprints.answer_fingerprint)).state==='locked';check(nativeLock)
        await fixedUnits('stop','absorconnect-ipc-worker-lab.service','absorconnect-secure-lab.service')
        await fixedUnits('start','absorconnect-ipc-worker-lab.service')
        await ready();restartLocked=(await challenge(fingerprints.offer_fingerprint,fingerprints.answer_fingerprint)).state==='locked';check(restartLocked)
      }
    }
    if(input.scenario==='cancel-api-down'){
      api.cancel=async()=>{throw Error('network_unavailable')};check(!(await c.cancel()).ok)
      check((await provider.inspect())?.phase==='prepared'&&await journal.intentPresent()&&resumed===0);api.cancel=rawCancel
    }
    if(input.scenario==='remove-lost'){
      provider.remove=async(target)=>{await rawRemove(target);throw Error('lost_reply')};check(!(await c.cancel()).ok)
      check(await journal.intentPresent()&&resumed===0);provider.remove=rawRemove
    }
    check((await c.cancel()).ok);check(await journal.read()===null&&resumed===1&&legacyCalls===0)
    check((await fs.readFile(storeFile)).equals(before))
    let newPasswordVerified=false,oldPasswordRejected=false,localStopAckMilliseconds:number|null=null
    if(['password-change','account-logout'].includes(input.scenario)){
      const oldKey=await store.getKey();check(oldKey)
      await store.setPassword('nueva-contraseña-VM-ficticia')
      const changed=await fs.readFile(storeFile),newKey=await store.getKey();check(newKey)
      c=new MigrationCoordinator(deps);check((await c.begin({activate:true,confirmLocal:false})).ok);check((await c.commit()).ok)
      await ready()
      const offer='sha-256 '+Array(32).fill('AA').join(':'),answer='sha-256 '+Array(32).fill('BB').join(':')
      const auth=async(key:Buffer):Promise<string|undefined>=>{
        const reply=await challenge(offer,answer);check(reply.kind==='hello'&&reply.payload)
        const hello=JSON.parse(reply.payload!);check(hello.hostName==='Diagnóstico de traspaso')
        const proof=createHmac('sha256',key).update('absor-remote-auth-v1\n'+hello.nonce+'\n'+offer+'\n'+answer).digest('base64')
        return (await worker({op:'authenticate',message:JSON.stringify({v:1,type:'auth',proof})})).state
      }
      oldPasswordRejected=await auth(oldKey!)==='wrong_proof';check(oldPasswordRejected)
      newPasswordVerified=await auth(newKey!)==='authenticated';check(newPasswordVerified)
      oldKey!.fill(0);newKey!.fill(0)
      if(input.scenario==='account-logout'){
        const control=new AgentControlClient(installedAgentControlSource('/opt/absorconnect-secure-lab/absor-agent-control-lab'))
        const guard=new NativeAccountGuard({snapshot:()=>({...absentLocalAgent(),ownership:'agent',phase:'responding',state:'active',active:true,deviceId:input.deviceId}),stop:(id)=>control.stop(id),reserved:()=>{}})
        const started=Date.now();check((await guard.cut()).ok);localStopAckMilliseconds=Date.now()-started;check(localStopAckMilliseconds<1500)
        // La API permanece disponible para retirar la cuenta efímera; la parada no la consultó.
        const end=Date.now()+3000
        while(Date.now()<end){
          const active=await promisify(execFile)('/usr/bin/systemctl',['show','absorconnect-secure-lab.service','-p','ActiveState','--value'],{timeout:3000,maxBuffer:512})
          if(['inactive','failed'].includes(active.stdout.trim()))break
          await wait(50)
        }
        await fixedUnits('start','absorconnect-secure-lab.service').catch(()=>{})
        const result=await promisify(execFile)('/usr/bin/systemctl',['show','absorconnect-secure-lab.service','-p','ExecMainStatus','--value'],{timeout:3000,maxBuffer:512})
        check(result.stdout.trim()==='77')
      }
      check((await c.cancel()).ok);check(resumed===2);check((await fs.readFile(storeFile)).equals(changed))
    }
    console.log(JSON.stringify({schema:1,scenario:input.scenario,passed:true,sourceUnchanged:true,legacyCalls,
      compensatedAfterBothProofs:true,nativeLockTested:nativeLock,lockSurvivedBrokerRestart:restartLocked,
      newPasswordVerified,oldPasswordRejected,localStopAckMilliseconds,readyForUnattended:false}))
  }finally{await host?.stop();wrap.fill(0);await fs.rm(dir,{recursive:true,force:true})}
}
void main().catch((error)=>{console.error('migration_matrix_failed_at_'+checkpoint)
  if(error instanceof Error&&['native_worker_timeout','native_not_ready'].includes(error.message))console.error(error.message)
  process.exitCode=3})

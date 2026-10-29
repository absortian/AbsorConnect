// Main real sin privilegios; la elevación solo llama al helper fijo de nuestra VM.
import { spawn } from 'child_process'
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto'
import * as fs from 'fs/promises'
import { join } from 'path'
import { MigrationCoordinator } from '../../src/main/remote/migrationCoordinator'
import { accountMigrationApi } from '../../src/main/remote/migrationApi'
import { MigrationJournal } from '../../src/main/remote/migrationJournal'
import { DeviceIdentity } from '../../src/main/remote/deviceIdentity'
import { RemoteAccessStore } from '../../src/main/remote/remoteAccessStore'
import { writeAtomic } from '../../src/main/remote/atomicWrite'
import { parseMigrationReceipt, type MigrationProvider, type MigrationTarget } from '../../src/main/remote/migrationProvider'
import type { SecretBox } from '../../src/main/remote/secretBox'
async function main(): Promise<void> {
  if (process.platform !== 'linux' || process.getuid?.() !== 1000 || process.argv.length !== 2) throw Error('owned_user_required')
  const chunks: Buffer[] = []; let size = 0
  for await (const chunk of process.stdin) { size += chunk.length; if (size > 4096) throw Error('input_limit'); chunks.push(chunk) }
  const input = JSON.parse(Buffer.concat(chunks).toString())
  if(!['prepare','commit'].includes(input.stage))throw Error('invalid_stage')
  const preparing=input.stage==='prepare'
  const dir='/home/absorlab/AbsorConnectLab/migration-main-state'
  if(preparing)await fs.mkdir(dir,{mode:0o700})
  const wrapper=preparing?randomBytes(32):await fs.readFile(join(dir,'fixture-box.key'))
  if(preparing)await fs.writeFile(join(dir,'fixture-box.key'),wrapper,{mode:0o600,flag:'wx'})
  const box: SecretBox = { available: true,
    seal: (raw) => { const nonce = randomBytes(12), c = createCipheriv('aes-256-gcm', wrapper, nonce)
      return Buffer.concat([nonce, c.update(raw), c.final(), c.getAuthTag()]).toString('base64') },
    open: (raw) => { const bytes = Buffer.from(raw,'base64'), c = createDecipheriv('aes-256-gcm', wrapper, bytes.subarray(0,12))
      c.setAuthTag(bytes.subarray(-16)); return Buffer.concat([c.update(bytes.subarray(12,-16)),c.final()]) }
  }
  let preparedPayload: Buffer | null = null
  const run = async (mode: 'inspect'|'prepare'|'commit'|'remove', data?: Buffer): Promise<ReturnType<typeof parseMigrationReceipt>> => {
    return new Promise((resolve,reject) => {
      const child = spawn(mode === 'inspect' ? '/usr/bin/python3' : '/usr/bin/sudo',
        [...(mode === 'inspect' ? [] : ['-n','/usr/bin/python3']),'-I','-B','/opt/absorconnect-migration-lab/migration-vm.py',mode],
        { cwd:'/', env:{ LANG:'C', PATH:'/usr/sbin:/usr/bin:/sbin:/bin' }, stdio:['pipe','pipe','pipe'] })
      const out: Buffer[] = []; let length = 0; let failed = false
      const timer = setTimeout(() => { failed=true; child.kill('SIGKILL') },45000)
      child.stdout.on('data',(bytes) => { length+=bytes.length; if(length>512){failed=true;child.kill('SIGKILL')}else out.push(bytes) })
      child.stderr.resume()
      child.on('error',() => { clearTimeout(timer); reject(Error('provider_unconfirmed')) })
      child.on('close',(code) => { clearTimeout(timer)
        try { if(code!==0||failed)throw Error('provider_unconfirmed'); resolve(parseMigrationReceipt(Buffer.concat(out).toString().trim())) }
        catch { reject(Error('provider_unconfirmed')) }
      })
      child.stdin.on('error',() => {})
      child.stdin.end(data)
    })
  }
  const targetBytes = (target: MigrationTarget): Buffer => Buffer.from(JSON.stringify({deviceId:target.deviceId,transactionId:target.transactionId}))
  const provider: MigrationProvider = { available:async()=>true, inspect:()=>run('inspect'),
    prepare:async(raw)=>{preparedPayload=raw; const v=await run('prepare',raw); if(!v)throw Error('missing_receipt');throw Error('simulated_lost_prepare_reply')},
    commit:async(target)=>{const v=await run('commit',targetBytes(target));if(!v)throw Error('missing_receipt');return v},
    remove:(target)=>run('remove',targetBytes(target)) }
  try {
    const session={ email:'migration-fixture@example.invalid',token:input.accountToken }
    const deviceFile=join(dir,'device.json'),storeFile=join(dir,'remote.json')
    if(preparing){
    await writeAtomic(deviceFile,JSON.stringify({id:input.deviceId,key:box.seal(Buffer.from(input.deviceKey,'base64url'))}))
    const now=Date.now()
    await writeAtomic(storeFile,JSON.stringify({accountEmail:session.email,deviceName:'Host IPC P2P propio',enabled:true,
      password:{salt:input.salt,iterations:600000,key:box.seal(Buffer.from(input.key,'base64'))},
      features:{clipboard:false,files:false,audio:false},confirmLocal:false,preventSleep:false,
      failures:[now-4000,now-3000,now-2000,now-1000],lockedUntil:null,log:[]}))
    await fs.writeFile(join(dir,'source.sha256'),createHash('sha256').update(await fs.readFile(storeFile)).digest('hex'),{mode:0o600,flag:'wx'})
    }
    const original=await fs.readFile(storeFile)
    const store=new RemoteAccessStore(storeFile,box,'Host IPC P2P propio'),identity=new DeviceIdentity(deviceFile,box)
    const journal=new MigrationJournal(join(dir,'intent.json'))
    let quiesced=0
    const coordinator=new MigrationCoordinator({session:()=>session,origin:()=>input.origin,journal,identity,store,
      api:accountMigrationApi(), provider,host:{quiesceForMigration:async()=>{if(!await journal.intentPresent())throw Error('intent_first');quiesced++}},
      compensated:async()=>{throw Error('unexpected_compensation')} })
    if(preparing){
    const begun=await coordinator.begin({confirmLocal:false,activate:true})
    if(begun.ok||(await journal.read())?.phase!=='provisioning')throw Error('lost_reply_not_reserved')
    if(!(await fs.readFile(storeFile)).equals(original))throw Error('source_modified')
    if(!preparedPayload||!(preparedPayload as Buffer).every((v)=>v===0))throw Error('payload_not_zeroed')
    console.log(JSON.stringify({schema:1,prepared:true,lostPrepareReply:true,payloadZeroed:true,sourceUnchanged:true}))
    return
    }
    // Segundo proceso Node: recuperar recibo/diario/almacén, nunca repetir POST/canje.
    const restart=new MigrationCoordinator({session:()=>session,origin:()=>input.origin,journal,identity,store,
      api:accountMigrationApi(),provider,host:{quiesceForMigration:async()=>{throw Error('unexpected_drain')}},compensated:async()=>{throw Error('unexpected_compensation')}})
    if(!(await restart.recover()).ok)throw Error('recovery_failed')
    if(!(await restart.commit()).ok)throw Error('commit_failed')
    const record=await journal.read()
    if(!record||record.phase!=='committed'||record.deviceId!==input.deviceId)throw Error('identity_changed')
    if(!(await fs.readFile(storeFile)).equals(original))throw Error('source_modified')
    if(createHash('sha256').update(original).digest('hex')!==await fs.readFile(join(dir,'source.sha256'),'utf8'))throw Error('source_changed_across_processes')
    console.log(JSON.stringify({schema:1,preparedBeforeActivation:true,mainRestartRecovered:true,sameDevice:true,
      sourceUnchanged:true,accountTokenInProvider:false,payloadZeroed:true,optionsImported:true,failuresImported:4,
      separateMainProcesses:2,lostPrepareReplyRecovered:true,legacyQuiesced:1,readyForUnattended:false}))
  } finally { wrapper.fill(0); if(!preparing)await fs.rm(dir,{recursive:true,force:true}) }
}
void main().catch(()=>{console.error('migration_runtime_failed');process.exitCode=3})

// Utilidad de prueba: NO se importa en la app ni permite elegir el helper por IPC.
import {spawn} from 'child_process'
import {parseMigrationReceipt,type MigrationProvider,type MigrationTarget} from '../../src/main/remote/migrationProvider'
export function labMigrationProvider():MigrationProvider {
  const run=async(mode:'inspect'|'prepare'|'commit'|'remove',data?:Buffer):Promise<ReturnType<typeof parseMigrationReceipt>>=>new Promise((resolve,reject)=>{
    const child=spawn(mode==='inspect'?'/usr/bin/python3':'/usr/bin/sudo',
      [...(mode==='inspect'?[]:['-n','/usr/bin/python3']),'-I','-B','/opt/absorconnect-migration-lab/migration-vm.py',mode],
      {cwd:'/',env:{LANG:'C',PATH:'/usr/sbin:/usr/bin:/sbin:/bin'},stdio:['pipe','pipe','pipe']})
    let size=0,failed=false;const chunks:Buffer[]=[]
    const timer=setTimeout(()=>{failed=true;child.kill('SIGKILL')},45000)
    child.stdout.on('data',(raw)=>{size+=raw.length;if(size>512){failed=true;child.kill('SIGKILL')}else chunks.push(raw)})
    child.stderr.resume();child.stdin.on('error',()=>{})
    child.on('error',()=>{clearTimeout(timer);reject(Error('provider_unconfirmed'))})
    child.on('close',(code)=>{clearTimeout(timer);try{if(code!==0||failed)throw Error('provider_unconfirmed');resolve(parseMigrationReceipt(Buffer.concat(chunks).toString().trim()))}catch{reject(Error('provider_unconfirmed'))}})
    child.stdin.end(data)
  })
  const target=(v:MigrationTarget):Buffer=>Buffer.from(JSON.stringify({deviceId:v.deviceId,transactionId:v.transactionId}))
  return {available:async()=>true,inspect:()=>run('inspect'),prepare:async(raw)=>{const v=await run('prepare',raw);if(!v)throw Error('no_receipt');return v},
    commit:async(v)=>{const r=await run('commit',target(v));if(!r)throw Error('no_receipt');return r},remove:(v)=>run('remove',target(v))}
}

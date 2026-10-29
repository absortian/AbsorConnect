// Compila únicamente fuentes locales; no instala componentes ni solicita TCC/UAC.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process'),esbuild=require('esbuild')
const root=path.resolve(__dirname,'../..'),lab=path.resolve(process.argv[2]||'')
if(process.argv.length!==3||lab===root||!fs.statSync(lab).isDirectory())throw Error('owned_lab_required')
const work=path.join(lab,'agent-setup-ui-'+crypto.randomUUID().replaceAll('-',''));fs.mkdirSync(work,{mode:0o700})
const aliases=new Map([
 ['src/main/background','export const getMainWindow=()=>globalThis.fixtureWindow'],
 ['src/main/cloud/session','export const currentSession=()=>globalThis.fixtureAccount'],
 ['src/main/store','export const getLanguage=async()=>"es"'],
 ['src/main/remote/hostRuntime','export const remoteHostStarted=async()=>{};export const agentSetup=()=>globalThis.fixtureSetup']
].map(([file,source])=>[path.join(root,file),source]))
async function main(){
  await esbuild.build({entryPoints:[path.join(root,'src/main/remote/agentSetupIpc.ts')],bundle:true,platform:'node',format:'cjs',external:['electron'],outfile:path.join(work,'setup-ipc.cjs'),plugins:[{name:'owned-fixtures',setup(build){
    build.onResolve({filter:/^\./},args=>{const target=path.resolve(path.dirname(args.importer),args.path);if(aliases.has(target))return {path:target,namespace:'fixture'}})
    build.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:aliases.get(args.path),loader:'js'}))
  }}]})
  await esbuild.build({entryPoints:[path.join(root,'src/preload/index.ts')],bundle:true,platform:'node',format:'cjs',external:['electron'],outfile:path.join(work,'preload.cjs')})
  await esbuild.build({entryPoints:[path.join(__dirname,'agent-setup-renderer.tsx')],bundle:true,platform:'browser',format:'esm',jsx:'automatic',outfile:path.join(work,'renderer.js')})
  fs.copyFileSync(path.join(__dirname,'agent-setup-main.cjs'),path.join(work,'main.cjs'))
  fs.writeFileSync(path.join(work,'index.html'),'<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data:"><link rel="stylesheet" href="renderer.css"><div id="root"></div><script type="module" src="renderer.js"></script>',{mode:0o600})
  const run=spawnSync(require('electron'),[path.join(work,'main.cjs'),'--owned-work='+work],{env:{...process.env,ELECTRON_RUN_AS_NODE:''},timeout:45000,encoding:'utf8'})
  fs.writeFileSync(path.join(work,'electron.log'),(run.stdout||'')+(run.stderr||''),{mode:0o600})
  if(run.status!==0)throw Error('setup_ui_failed_inspect_private_log')
  console.log('Informe local: '+path.join(work,'report.json'))
}
void main().catch(()=>{console.error('setup_ui_failed: '+work);process.exitCode=3})

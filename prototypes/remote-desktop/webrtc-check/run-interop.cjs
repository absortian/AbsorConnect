// Lanza una instancia aislada de Electron contra el binario efímero nativo.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawn } = require('node:child_process')
const esbuild = require('esbuild')
const lab = process.argv[2] && fs.realpathSync(process.argv[2])
if (!lab) { console.error('Uso: node run-interop.cjs <laboratorio-externo>'); process.exit(64) }
const syntheticVideo = process.argv[3] === '--synthetic-video'
if (process.argv.length > 4 || (process.argv[3] && !syntheticVideo)) throw new Error('Opción desconocida')
const binary = path.join(lab, 'webrtc-native/src/out/AbsorProbe', syntheticVideo ? 'video_channel_check' : 'channel_check')
if (!fs.statSync(binary).isFile()) throw new Error('Falta compilar channel_check')
const build = JSON.parse(fs.readFileSync(path.join(lab, 'webrtc-probe-results.json'), 'utf8'))
const binarySha256 = crypto.createHash('sha256').update(fs.readFileSync(binary)).digest('hex')
if (build.webrtcRevision !== require('./dependencies.json').webrtc.revision ||
    (syntheticVideo ? build.videoEndpoint : build.channelEndpoint)?.sha256 !== binarySha256) {
  throw new Error('El extremo nativo no coincide con el informe de compilación; vuelve a ejecutar build.py')
}
const work = fs.mkdtempSync(path.join(lab, 'interop-'))
fs.chmodSync(work, 0o700)
for (const name of ['interop-main.cjs', 'interop-preload.cjs']) fs.copyFileSync(path.join(__dirname, name), path.join(work, name))
fs.writeFileSync(path.join(work, 'index.html'), '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'"><title>Prueba WebRTC nativa</title><script type="module" src="renderer.js"></script>', { mode: 0o600 })
esbuild.buildSync({ entryPoints: [path.join(__dirname, 'interop-renderer.js')], bundle: true,
  platform: 'browser', format: 'esm', target: 'chrome142', outfile: path.join(work, 'renderer.js') })
fs.writeFileSync(path.join(work, 'artifact.json'), JSON.stringify({
  binarySha256,
  sourceRevision: require('./dependencies.json').webrtc.revision
}, null, 2) + '\n', { mode: 0o600 })
const child = spawn(require('electron'), [path.join(work, 'interop-main.cjs'), `--lab-work=${work}`, `--lab-binary=${binary}`, ...(syntheticVideo ? ['--lab-synthetic-video'] : [])], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '' }, stdio: 'inherit'
})
child.on('error', (error) => { console.error(error.message); process.exitCode = 1 })
child.on('exit', (code) => { console.log(`Informe local: ${path.join(work, 'interop-results.json')}`); process.exitCode = code ?? 1 })

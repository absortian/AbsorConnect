// Lanza una instancia aislada de Electron contra el binario efímero nativo.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawn } = require('node:child_process')
const esbuild = require('esbuild')
const lab = process.argv[2] && fs.realpathSync(process.argv[2])
if (!lab) { console.error('Uso: node run-interop.cjs <laboratorio-externo>'); process.exit(64) }
const options = process.argv.slice(3)
let syntheticVideo = false
let relayController = false
let supervised = false
let agentConfig
let turnConfig
for (let i = 0; i < options.length; i++) {
  if (options[i] === '--supervised' && !supervised) supervised = true
  else if (options[i] === '--relay-controller' && !relayController) relayController = true
  else if (options[i] === '--synthetic-video' && !syntheticVideo) syntheticVideo = true
  else if (options[i] === '--agent-config' && !agentConfig && options[i + 1]) { agentConfig = options[++i]; syntheticVideo = true }
  else if (options[i] === '--turn-config' && !turnConfig && options[i + 1]) turnConfig = options[++i]
  else throw new Error('Opción desconocida o repetida')
}
if (supervised && !agentConfig) throw new Error('--supervised exige --agent-config')
if (relayController && !turnConfig) throw new Error('--relay-controller exige --turn-config')
let relayConfiguration
if (turnConfig) {
  const stat = fs.lstatSync(turnConfig)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384 || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid()) {
    throw new Error('La configuración TURN debe ser un archivo privado del usuario, de hasta 16 KiB')
  }
  const value = JSON.parse(fs.readFileSync(turnConfig, 'utf8'))
  if (!value || Object.keys(value).some((key) => key !== 'iceServers') || !Array.isArray(value.iceServers) ||
      value.iceServers.length < 1 || value.iceServers.length > 8 || value.iceServers.some((server) =>
        !server || Object.keys(server).some((key) => !['urls', 'username', 'credential'].includes(key)) ||
        !Array.isArray(server.urls) || server.urls.length < 1 || server.urls.length > 8 ||
        server.urls.some((url) => typeof url !== 'string' || url.length > 512 || !/^(?:turns?|stun):[^\s]+$/.test(url)) ||
        ['username', 'credential'].some((key) => typeof server[key] !== 'string' || server[key].length < 1 || server[key].length > 1024))) {
    throw new Error('Configuración TURN inválida; usar únicamente credenciales temporales')
  }
  if (!value.iceServers.some((server) => server.urls.some((url) => /^turns?:/.test(url)))) throw new Error('Falta servidor TURN')
  relayConfiguration = value
}
const binary = path.join(lab, 'webrtc-native/src/out/AbsorProbe', agentConfig ? 'rust_video_channel_check' : syntheticVideo ? 'video_channel_check' : 'channel_check')
if (!fs.statSync(binary).isFile()) throw new Error('Falta compilar channel_check')
const build = JSON.parse(fs.readFileSync(path.join(lab, 'webrtc-probe-results.json'), 'utf8'))
const binarySha256 = crypto.createHash('sha256').update(fs.readFileSync(binary)).digest('hex')
if (build.webrtcRevision !== require('./dependencies.json').webrtc.revision ||
    (agentConfig ? build.rustEndpoint : syntheticVideo ? build.videoEndpoint : build.channelEndpoint)?.sha256 !== binarySha256) {
  throw new Error('El extremo nativo no coincide con el informe de compilación; vuelve a ejecutar build.py')
}
const supervisor = path.join(lab, 'webrtc-native/src/absor_connect_probe/absor-lab-supervisor')
if (agentConfig && crypto.createHash('sha256').update(fs.readFileSync(path.join(lab, 'webrtc-native/src/absor_connect_probe/libabsor_agent_webrtc_lab.dylib'))).digest('hex') !== build.rustLibrarySha256) throw new Error('Biblioteca Rust distinta de la compilada')
if (supervised && crypto.createHash('sha256').update(fs.readFileSync(supervisor)).digest('hex') !== build.supervisorSha256) throw new Error('Supervisor distinto del compilado')
const work = fs.mkdtempSync(path.join(lab, 'interop-'))
fs.chmodSync(work, 0o700)
// Publicar pronto la ruta propia permite retirar credenciales también en fallos.
console.log(`Informe local: ${path.join(work, 'interop-results.json')}`)
if (agentConfig) {
  const stat = fs.lstatSync(agentConfig)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384 || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid()) throw new Error('Configuración de agente no privada')
  fs.copyFileSync(agentConfig, path.join(work, 'agent-manifest.json'))
  fs.chmodSync(path.join(work, 'agent-manifest.json'), 0o600)
}
if (relayConfiguration) fs.writeFileSync(path.join(work, 'turn-config.json'), JSON.stringify(relayConfiguration), { mode: 0o600, flag: 'wx' })
for (const name of ['interop-main.cjs', 'interop-preload.cjs']) fs.copyFileSync(path.join(__dirname, name), path.join(work, name))
fs.writeFileSync(path.join(work, 'index.html'), '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'"><title>Prueba WebRTC nativa</title><script type="module" src="renderer.js"></script>', { mode: 0o600 })
esbuild.buildSync({ entryPoints: [path.join(__dirname, 'interop-renderer.js')], bundle: true,
  platform: 'browser', format: 'esm', target: 'chrome142', outfile: path.join(work, 'renderer.js') })
fs.writeFileSync(path.join(work, 'artifact.json'), JSON.stringify({
  binarySha256,
  sourceRevision: require('./dependencies.json').webrtc.revision
}, null, 2) + '\n', { mode: 0o600 })
const child = spawn(require('electron'), [path.join(work, 'interop-main.cjs'), `--lab-work=${work}`, `--lab-binary=${binary}`, ...(supervised ? [`--lab-supervisor=${supervisor}`] : []), ...(agentConfig ? ['--lab-agent-bridge'] : []), ...(syntheticVideo ? ['--lab-synthetic-video'] : []), ...(relayConfiguration ? ['--lab-relay-only'] : []), ...(relayController ? ['--lab-relay-controller'] : [])], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '' }, stdio: 'inherit'
})
child.on('error', (error) => { console.error(error.message); process.exitCode = 1 })
child.on('exit', (code, signal) => { console.log(`Salida Electron: ${code}; señal: ${signal ?? 'ninguna'}`); if (relayConfiguration) { fs.rmSync(path.join(work, 'turn-config.json'), { force: true }); fs.rmSync(path.join(work, 'native-ice.json'), { force: true }) }; process.exitCode = code ?? 1 })

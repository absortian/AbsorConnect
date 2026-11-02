// Comprueba el paquete generado, sin abrir Electron ni leer valores de credenciales.
const fs = require('node:fs')
const path = require('node:path')

async function main() {
  const asar = await import('@electron/asar')
  const root = path.resolve(__dirname, '../../..', 'dist')
  const candidates = []
  for (const name of ['win-unpacked', 'linux-unpacked']) {
    const file = path.join(root, name, 'resources', 'app.asar')
    if (fs.existsSync(file)) candidates.push({ name, file })
  }
  for (const name of ['mac', 'mac-arm64']) {
    const directory = path.join(root, name)
    if (!fs.existsSync(directory)) continue
    for (const app of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!app.isDirectory() || !app.name.endsWith('.app')) continue
      const file = path.join(directory, app.name, 'Contents', 'Resources', 'app.asar')
      if (fs.existsSync(file)) candidates.push({ name, file })
    }
  }
  if (candidates.length === 0) throw new Error('packaged_asar_missing')
  const required = ['package.json', 'out/main/index.js', 'out/preload/index.js',
    'out/preload/host.js', 'out/preload/viewer.js', 'out/renderer/index.html',
    'out/renderer/host.html', 'out/renderer/viewer.html']
  const forbidden = new Set(['agent', 'backend', 'bin', 'docker', 'docs', 'kube',
    'openspec', 'mobile', 'prototypes', 'src', '.git', '.docker', '.node-home'])
  const reports = []
  for (const { name, file } of candidates) {
    const metadata = fs.lstatSync(file)
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('packaged_asar_type')
    const entries = asar.listPackage(file).map(value => value.replace(/^\//, ''))
    if (entries.length > 100000) throw new Error('packaged_asar_bound')
    for (const value of entries) {
      if (value.includes('\0') || value.split('/').includes('..') || forbidden.has(value.split('/')[0])) {
        throw new Error('development_source_in_package')
      }
    }
    for (const value of required) {
      if (!entries.includes(value) || asar.statFile(file, value).size < 1) throw new Error('packaged_runtime_missing')
    }
    const native = entries.filter(value => value.endsWith('.node') && /(?:^|\/)node_modules\/(?:koffi|@koromix)\//.test(value))
    if (native.length === 0) throw new Error('packaged_native_binding_missing')
    for (const value of native) {
      const header = asar.statFile(file, value)
      const disk = path.join(file + '.unpacked', value)
      if (!header.unpacked || !fs.statSync(disk).isFile()) throw new Error('native_binding_must_be_unpacked')
    }
    reports.push({ package: name, entries: entries.length, nativeBindings: native.length,
      developmentSourcesExcluded: true, nativeBindingsUnpacked: true })
  }
  console.log(JSON.stringify({ schema: 1, ok: true, reports }))
}

main().catch(error => {
  const code = /^[a-z_]+$/.test(error.message) ? error.message : 'packaged_asar_check_failed'
  console.error(code)
  process.exitCode = 1
})

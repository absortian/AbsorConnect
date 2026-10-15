// Puente mínimo entre las páginas del prototipo y el proceso principal
const { contextBridge, ipcRenderer } = require('electron')

const arg = process.argv.find((a) => a.startsWith('--proto-config='))
const config = arg ? JSON.parse(arg.slice('--proto-config='.length)) : {}

contextBridge.exposeInMainWorld('proto', {
  config,
  send: (channel, data) => ipcRenderer.send(channel, data),
  onSignal: (callback) => ipcRenderer.on('signal', (_event, message) => callback(message))
})

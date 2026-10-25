const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('lab', {
  supervised: process.argv.includes('--lab-supervised'),
  agentBridge: process.argv.includes('--lab-agent-bridge'),
  credentialProbe: () => ipcRenderer.invoke('lab-credential-probe'),
  fault: (name) => ipcRenderer.invoke('lab-fault', name),
  ice: () => ipcRenderer.invoke('lab-ice'),
  relayController: process.argv.includes('--lab-relay-controller'),
  relayOnly: process.argv.includes('--lab-relay-only'),
  syntheticVideo: process.argv.includes('--lab-synthetic-video'),
  offer: (name, offer) => ipcRenderer.invoke('lab-offer', name, offer),
  result: (name, result) => ipcRenderer.invoke('lab-result', name, result),
  done: (result) => ipcRenderer.invoke('lab-done', result)
})

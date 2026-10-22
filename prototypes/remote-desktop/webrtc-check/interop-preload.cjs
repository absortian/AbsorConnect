const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('lab', {
  syntheticVideo: process.argv.includes('--lab-synthetic-video'),
  offer: (name, offer) => ipcRenderer.invoke('lab-offer', name, offer),
  result: (name, result) => ipcRenderer.invoke('lab-result', name, result),
  done: (result) => ipcRenderer.invoke('lab-done', result)
})

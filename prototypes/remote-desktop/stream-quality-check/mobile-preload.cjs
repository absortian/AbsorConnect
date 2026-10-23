const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('lab', {
  config: () => ipcRenderer.invoke('quality-config'),
  onOffer: callback => ipcRenderer.on('quality-offer', (_, offer) => callback(offer)),
  answer: value => ipcRenderer.send('quality-answer', value),
  ready: () => ipcRenderer.send('quality-ready')
})

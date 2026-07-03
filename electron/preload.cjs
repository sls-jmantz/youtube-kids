const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('appApi', {
  readSettings: () => ipcRenderer.invoke('settings:read'),
  writeSettings: (settings) => ipcRenderer.invoke('settings:write', settings),
  setPin: (pin) => ipcRenderer.invoke('pin:set', pin),
  verifyPin: (pin) => ipcRenderer.invoke('pin:verify', pin),
  fetchChannelFeed: (channelId) => ipcRenderer.invoke('youtube:feed', channelId),
  resolveChannel: (request) => ipcRenderer.invoke('youtube:resolveChannel', request),
  discoverChannels: (request) => ipcRenderer.invoke('youtube:discover', request),
});

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('appApi', {
  readSettings: () => ipcRenderer.invoke('settings:read'),
  writeSettings: (settings) => ipcRenderer.invoke('settings:write', settings),
  exportSettings: () => ipcRenderer.invoke('settings:export'),
  importSettings: () => ipcRenderer.invoke('settings:import'),
  readLog: () => ipcRenderer.invoke('log:read'),
  setPin: (pin) => ipcRenderer.invoke('pin:set', pin),
  verifyPin: (pin) => ipcRenderer.invoke('pin:verify', pin),
  fetchChannelFeed: (channelId) => ipcRenderer.invoke('youtube:feed', channelId),
  fetchChannelVideos: (channelId) => ipcRenderer.invoke('youtube:channelVideos', channelId),
  resolveChannel: (request) => ipcRenderer.invoke('youtube:resolveChannel', request),
  discoverChannels: (request) => ipcRenderer.invoke('youtube:discover', request),
});

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopApp", {
  restartService: () => ipcRenderer.invoke("desktop:restart-service"),
  openLogs: () => ipcRenderer.invoke("desktop:open-logs"),
  quitApp: () => ipcRenderer.invoke("desktop:quit"),
});

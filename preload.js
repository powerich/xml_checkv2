const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  selectFolder: () => ipcRenderer.invoke("select-folder"),
  selectFile: () => ipcRenderer.invoke("select-file"),
  startCheck: (targetPath) => ipcRenderer.invoke("start-check", targetPath),
  openFolder: (folderPath) => ipcRenderer.invoke("open-folder", folderPath),
  onProgress: (callback) => ipcRenderer.on("progress", (event, data) => callback(data))
});

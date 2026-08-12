const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require("electron");
const path = require("path");
const { runBatchCheck } = require("./checker.js");

function createWindow() {
  const win = new BrowserWindow({
    width: 900,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  Menu.setApplicationMenu(null);
  win.loadFile("index.html");
  return win;
}

let mainWindow;

app.whenReady().then(() => {
  mainWindow = createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// ---------- IPC：选择文件夹 ----------
ipcMain.handle("select-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"]
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// ---------- IPC：选择单个 XML 文件 ----------
ipcMain.handle("select-file", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: [{ name: "XML 文件", extensions: ["xml"] }]
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// ---------- IPC：开始检查（文件夹或单个文件均可，自动判断） ----------
ipcMain.handle("start-check", async (event, targetPath) => {
  try {
    const summary = await runBatchCheck(targetPath, (current, total) => {
      event.sender.send("progress", { current, total });
    });
    return { success: true, summary };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ---------- IPC：打开文件夹（在系统文件管理器里显示） ----------
ipcMain.handle("open-folder", async (event, folderPath) => {
  shell.openPath(folderPath);
});
import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { PobBridgeService, type PobTarget } from './pob-bridge'

let mainWindow: BrowserWindow | null = null
let pobBridge: PobBridgeService | null = null
let selectedPid: number | null = null
let hasSelectedTarget = false

function toRendererTarget(target: PobTarget): { pid: number; buildName: string | null } {
  return { pid: target.pid, buildName: target.buildName }
}

function getRendererState(): { targets: { pid: number; buildName: string | null }[]; selectedPid: number | null } {
  return { targets: pobBridge?.getTargets().map(toRendererTarget) ?? [], selectedPid }
}

function createWindow(): void {
  const window = new BrowserWindow({
    title: 'PoB Agent',
    width: 460,
    height: 540,
    minWidth: 360,
    minHeight: 360,
    backgroundColor: '#15171c',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#15171c',
      symbolColor: '#f2f3f5',
      height: 29,
    },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  mainWindow = window
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  pobBridge = new PobBridgeService(app.getPath('userData'))
  pobBridge.on('changed', (targets: PobTarget[]) => {
    if (selectedPid !== null && !targets.some((target) => target.pid === selectedPid)) {
      const processExited = !pobBridge?.isProcessAlive(selectedPid)
      selectedPid = null
      if (processExited) app.quit()
    }
    mainWindow?.webContents.send('pob:targets-changed', getRendererState())
  })
  try {
    await pobBridge.start()
  } catch (error) {
    console.error('PoB bridge could not start:', error)
  }
  createWindow()
})
ipcMain.handle('pob:get-state', getRendererState)
ipcMain.handle('pob:select-target', (_event, pid: unknown) => {
  if (!Number.isSafeInteger(pid) || (pid as number) <= 0 || !pobBridge?.hasTarget(pid as number)) {
    return { error: '선택한 PoB 연결이 종료되었습니다.' }
  }
  if (hasSelectedTarget && selectedPid !== pid) {
    return { error: '연결된 PoB는 변경할 수 없습니다.' }
  }
  selectedPid = pid as number
  hasSelectedTarget = true
  const target = pobBridge.getTargets().find((item) => item.pid === selectedPid)
  return target ? { target: toRendererTarget(target) } : { error: '선택한 PoB 연결이 종료되었습니다.' }
})
app.on('before-quit', () => {
  void pobBridge?.stop()
})
app.on('window-all-closed', () => app.quit())
